/*globals Backbone _ jQuery Handlebars */

var Shareabouts = Shareabouts || {};

(function(S, $, console) {
  // Handlebars support for Marionette
  var MarionetteLoadTemplate = Marionette.TemplateCache.prototype.loadTemplate;
  Marionette.TemplateCache.prototype.loadTemplate = function(templateId, options){
    var template, templateFunc;

    try {
      template = MarionetteLoadTemplate.call(this, templateId, options);
    }
    catch (e) {
      templateFunc = Handlebars.templates[templateId.replace(/^#+/, '')];
      if (!templateFunc) { throwError(e.message, e.name); }
      else { template = templateFunc(); }
    }
    return template;
  }

  Backbone.Marionette.TemplateCache.prototype.compileTemplate = function(rawTemplate) {
    return Handlebars.compile(rawTemplate);
  };

  S.PlaceListItemView = Backbone.Marionette.Layout.extend({
    // A flavor that ships place-list-item.html draws each room as a short
    // card; without one, a row is the whole room page, as it always was.
    template: function(data) {
      var t = Handlebars.templates || {};
      return (t['place-list-item'] || t['place-detail'])(data);
    },
    // The list reuses the room page's template, so it has to say where it
    // is: here each photo sits in a ~144px slot, and place-detail.html uses
    // the small thumbnail instead of the full 1600px file when it sees this.
    templateHelpers: { in_list: true },
    tagName: 'li',
    className: 'clearfix',
    regions: {
      support: '.support'
    },
    modelEvents: {
      'show': 'show',
      'hide': 'hide',
      'change': 'render'
    },
    initialize: function() {
      var supportType = S.Config.support.submission_type;

      this.model.submissionSets[supportType] = this.model.submissionSets[supportType] ||
        new S.SubmissionCollection(null, {
          submissionType: supportType,
          placeModel: this.model
        });

      this.supportView = new S.SupportView({
        collection: this.model.submissionSets[S.Config.support.submission_type],
        supportConfig: S.Config.support,
        userToken: S.Config.userToken
      });
    },
    onRender: function(evt) {
      // The card has no support button; the full room page row did.
      if (this.$('.support').length) {
        this.support.show(this.supportView);
      }
    },
    show: function() {
      this.$el.show();
    },
    hide: function() {
      this.$el.hide();
    }
  });

  S.PlaceListView = Backbone.Marionette.CompositeView.extend({
    template: '#place-list',
    itemView: S.PlaceListItemView,
    itemViewContainer: '.place-list',
    ui: {
      searchField: '#list-search',
      searchForm: '.list-search-form',
      allSorts: '.list-sort-menu a',
      date: '.date-sort',
      surveyCount: '.survey-sort',
      supportCount: '.support-sort',
      // KothaKhoj's list header (flavors/satish/jstemplates/place-list.html).
      // Absent from the core template, where these simply match nothing.
      chips: '.kk-chip',
      sortSelect: '#kk-list-sort',
      collegeLabel: '.kk-list-college',
      collegeSelect: '#kk-list-college',
      count: '.kk-list-count',
      clear: '.kk-list-clear',
      empty: '.kk-list-empty'
    },
    events: {
      'input @ui.searchField': 'handleSearchInput',
      'submit @ui.searchForm': 'handleSearchSubmit',
      'click @ui.date': 'handleDateSort',
      'click @ui.surveyCount': 'handleSurveyCountSort',
      'click @ui.supportCount': 'handleSupportCountSort',
      'click @ui.chips': 'handleChip',
      'change @ui.sortSelect': 'handleSortSelect',
      'change @ui.collegeSelect': 'handleCollegeSelect',
      'click @ui.clear': 'handleClear'
    },
    initialize: function(options) {
      options = options || {};

      // Init the views cache
      this.views = {};

      // Set the default sort
      this.sortBy = 'date';

      // Initialize the list filter
      this.collectionFilters = options.filter || {};
      this.searchTerm = options.term || '';

      // The chips' state and the college the "nearest" sort measures from.
      this.kkState = { type: '', kitchen: '', rentMax: 0, freeNow: false };
      this.kkOrigin = null;

      // The college list arrives from a sheet, possibly after the list has
      // rendered; fill the picker whenever it lands.
      var self = this;
      $(document).on('kk:colleges', function() { self.fillColleges(); });
    },
    // The KothaKhoj helpers in the flavor's custom.js, when present.
    kk: function() {
      var KK = window.KothaKhoj;
      return (KK && KK.list) ? KK : null;
    },
    onRender: function() {
      this.fillColleges();
    },
    fillColleges: function() {
      var KK = window.KothaKhoj,
          $select = this.ui.collegeSelect;
      if (!KK || !KK.colleges || !KK.colleges.list || !$select || !$select.length) { return; }
      if ($select.children('option').length > 1) { return; }
      KK.colleges.list.slice().sort(function(a, b) {
        return a.name.localeCompare(b.name);
      }).forEach(function(c) {
        $('<option>').val(c.lat + ',' + c.lng).text(c.name).appendTo($select);
      });
    },
    handleChip: function(evt) {
      evt.preventDefault();
      var $chip = $(evt.currentTarget),
          key = $chip.data('filter'),
          value = String($chip.data('value') == null ? '' : $chip.data('value'));

      if (key === 'freeNow') {
        // A toggle, not one of a group.
        this.kkState.freeNow = !this.kkState.freeNow;
        $chip.toggleClass('is-selected', this.kkState.freeNow)
             .attr('aria-pressed', String(this.kkState.freeNow));
      } else {
        this.kkState[key] = (key === 'rentMax') ? (parseInt(value, 10) || 0) : value;
        $chip.siblings('.kk-chip').removeClass('is-selected');
        $chip.addClass('is-selected');
      }
      this.applyFilters(this.collectionFilters, this.searchTerm);
    },
    handleClear: function(evt) {
      evt.preventDefault();
      this.kkState = { type: '', kitchen: '', rentMax: 0, freeNow: false };
      this.ui.chips.removeClass('is-selected').filter('[data-value=""]').addClass('is-selected');
      this.ui.chips.filter('.kk-chip-toggle').attr('aria-pressed', 'false');
      this.ui.searchField.val('');
      this.search('');
    },
    handleSortSelect: function(evt) {
      var value = $(evt.currentTarget).val();
      // "Nearest" needs a college first; until one is chosen the list keeps
      // its current order rather than sorting by nothing.
      this.ui.collegeLabel.prop('hidden', value !== 'nearest');
      if (value === 'nearest' && !this.kkOrigin) { this.fillColleges(); return; }
      this.sortBy = value;
      this.sort();
    },
    handleCollegeSelect: function(evt) {
      var $select = $(evt.currentTarget),
          parts = String($select.val() || '').split(',');
      var lat = parseFloat(parts[0]), lng = parseFloat(parts[1]);
      this.kkOrigin = (isFinite(lat) && isFinite(lng)) ? { lat: lat, lng: lng } : null;
      this.kkOriginName = $select.find('option:selected').text();
      if (!this.kkOrigin) { return; }
      this.sortBy = 'nearest';
      this.sort();
    },
    onAfterItemAdded: function(view) {
      // Cache the views as they are added
      this.views[view.model.cid] = view;
    },
    renderList: function() {
      // A faster alternative to this._renderChildren. _renderChildren always
      // discards and recreates a new ItemView. This simply rerenders the
      // cached views.
      var $itemViewContainer = this.getItemViewContainer(this);
      $itemViewContainer.empty();
      this.collection.each(function(model) {
        $itemViewContainer.append(this.views[model.cid].$el);
        // Delegate the events so that the subviews still work
        this.views[model.cid].supportView.delegateEvents();
      }, this);
    },
    handleSearchInput: function(evt) {
      evt.preventDefault();
      this.search(this.ui.searchField.val());
    },
    handleSearchSubmit: function(evt) {
      evt.preventDefault();
      this.search(this.ui.searchField.val());
    },
    handleDateSort: function(evt) {
      evt.preventDefault();

      this.sortBy = 'date';
      this.sort();

      this.updateSortLinks();
    },
    handleSurveyCountSort: function(evt) {
      evt.preventDefault();

      this.sortBy = 'surveyCount';
      this.sort();

      this.updateSortLinks();
    },
    handleSupportCountSort: function(evt) {
      evt.preventDefault();

      this.sortBy = 'supportCount';
      this.sort();

      this.updateSortLinks();
    },
    updateSortLinks: function() {
      this.ui.allSorts.removeClass('is-selected');
      // KothaKhoj's sorts are a select, not links, so there may be no link
      // for the current sort at all.
      if (this.ui[this.sortBy] && this.ui[this.sortBy].addClass) {
        this.ui[this.sortBy].addClass('is-selected');
      }
    },
    dateSort: function(a, b) {
      if (a.get('created_datetime') > b.get('created_datetime')) {
        return -1;
      } else {
        return 1;
      }
    },
    surveyCountSort: function(a, b) {
      var submissionA = a.submissionSets[S.Config.survey.submission_type],
          submissionB = b.submissionSets[S.Config.survey.submission_type],
          aCount = submissionA ? submissionA.size() : 0,
          bCount = submissionB ? submissionB.size() : 0;

      if (aCount === bCount) {
        if (a.get('created_datetime') > b.get('created_datetime')) {
          return -1;
        } else {
          return 1;
        }
      } else if (aCount > bCount) {
        return -1;
      } else {
        return 1;
      }
    },
    supportCountSort: function(a, b) {
      var submissionA = a.submissionSets[S.Config.support.submission_type],
          submissionB = b.submissionSets[S.Config.support.submission_type],
          aCount = submissionA ? submissionA.size() : 0,
          bCount = submissionB ? submissionB.size() : 0;

      if (aCount === bCount) {
        if (a.get('created_datetime') > b.get('created_datetime')) {
          return -1;
        } else {
          return 1;
        }
      } else if (aCount > bCount) {
        return -1;
      } else {
        return 1;
      }
    },
    sort: function() {
      var sortFunction = this.sortBy + 'Sort',
          KK = this.kk(),
          sortBy = this.sortBy,
          origin = this.kkOrigin;

      if (KK && (sortBy === 'cheapest' || sortBy === 'nearest')) {
        this.collection.comparator = function(a, b) {
          return KK.list.compare(sortBy, a.attributes, b.attributes, origin);
        };
      } else {
        this.collection.comparator = this[sortFunction] || this.dateSort;
      }
      this.collection.sort();
      this.renderList();
      this.showDistances(KK, sortBy === 'nearest' ? origin : null);
      this.search(this.ui.searchField.val());
    },
    // "350 m from Butwal Multiple Campus" on each card while sorted by
    // nearest; blank otherwise, so a stale distance never lingers.
    showDistances: function(KK, origin) {
      var name = this.kkOriginName || '';
      this.collection.each(function(model) {
        var view = this.views[model.cid];
        if (!view) { return; }
        var $d = view.$('.kk-card-distance'), p;
        if (!KK || !origin || !(p = KK.list.latLng(model.attributes))) { $d.text(''); return; }
        $d.text(KK.list.distanceText(KK.list.distanceM(origin.lat, origin.lng, p[0], p[1])) +
                (name ? ' from ' + name : ''));
      }, this);
    },
    clearFilters: function() {
      this.collectionFilters = {};
      this.applyFilters(this.collectionFilters, this.searchTerm);
    },
    filter: function(filters, replace=false) {
      if (replace) {
        this.collectionFilters = filters;
      } else {
        _.extend(this.collectionFilters, filters);
      }
      this.applyFilters(this.collectionFilters, this.searchTerm);
    },
    search: function(term) {
      this.searchTerm = term;
      this.applyFilters(this.collectionFilters, this.searchTerm);
    },
    applyFilters: function(filters, term) {
      var KK = this.kk();
      if (KK) { return this.applyKKFilters(filters, term, KK); }
      return this.applyCoreFilters(filters, term);
    },
    // A route filter (the menu's room type) must still match exactly.
    matchesRouteFilters: function(model, filters) {
      var key, val;
      for (key in filters) {
        val = filters[key];
        if (_.isFunction(val)) {
          if (!val(model)) { return false; }
        } else if (!model.get(key) || val.toUpperCase() !== model.get(key).toUpperCase()) {
          return false;
        }
      }
      return true;
    },
    applyKKFilters: function(filters, term, KK) {
      var self = this, state = this.kkState, shown = 0, total = 0;
      term = term || '';
      this.collection.each(function(model) {
        total++;
        var ok = self.matchesRouteFilters(model, filters) &&
                 KK.list.matches(model.attributes, state) &&
                 KK.list.matchesTerm(model.attributes, term);
        if (ok) { shown++; model.trigger('show'); } else { model.trigger('hide'); }
      });
      if (this.ui.count && this.ui.count.text) {
        this.ui.count.text(KK.list.countText(shown, total));
        this.ui.clear.prop('hidden', !KK.list.isFiltered(state, term));
        this.ui.empty.prop('hidden', !(total > 0 && shown === 0));
      }
    },
    applyCoreFilters: function(filters, term) {
      var len = S.Config.place.items.length,
          val, key, i;

      term = (term || '').toUpperCase();
      this.collection.each(function(model) {
        var show = function() { model.trigger('show'); },
            hide = function() { model.trigger('hide'); },
            submitter, locationType;

        // If the model doesn't match one of the filters, hide it.
        for (key in filters) {
          val = filters[key];
          if (_.isFunction(val)) {
            if (!val(model)) {
              return hide();
            }
          } else {
            if (!model.get(key) || val.toUpperCase() !== model.get(key).toUpperCase()) {
              return hide();
            }
          }
        }

        // Check whether the remaining models match the search term
        for (i=0; i<len; i++) {
          key = S.Config.place.items[i].name;
          val = model.get(key);
          if (_.isString(val) && val.toUpperCase().indexOf(term) !== -1) {
            return show();
          }
        }

        // Submitter is only present when a user submits a place when logged in
        // with FB or Twitter. We handle it specially because it is an object,
        // not a string.
        // These two blocks used to start `if (!show && ...)`. `show` is the
        // function above, always truthy, so neither block ever ran.
        submitter = model.get('submitter');
        if (submitter) {
          if (submitter.name && submitter.name.toUpperCase().indexOf(term) !== -1 ||
              submitter.username && submitter.username.toUpperCase().indexOf(term) !== -1) {
            return show();
          }
        }

        // If the location_type has a label, we should search in it also.
        locationType = S.Config.flavor.place_types[model.get('location_type')];
        if (locationType && locationType.label) {
          if (locationType.label.toUpperCase().indexOf(term) !== -1) {
            return show();
          }
        }

        // If we've fallen through here, hide the item.
        return hide();
      });
    },
    isVisible: function() {
      return this.$el.is(':visible');
    }
  });

}(Shareabouts, jQuery, Shareabouts.Util.console));
