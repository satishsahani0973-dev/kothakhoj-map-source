/*globals _ Spinner Handlebars Backbone jQuery Gatekeeper */

var Shareabouts = Shareabouts || {};

(function(S, $, console){
  S.PlaceFormView = Backbone.View.extend({
    // View responsible for the form for adding and editing places.
    events: {
      'submit form': 'onSubmit',
      'change input[type="file"]': 'onInputFileChange',
      'click .kk-photos-clear': 'onClearPhotos',
      'click .kk-add-room': 'onAddRoom',
      'click .kk-room-remove': 'onRemoveRoom',
      'click .kk-room-edit': 'onEditRoom',
      'click .kk-room-less': 'onRoomLess',
      'click .kk-room-more': 'onRoomMore',
      'change [data-group-required]': 'onRequiredOptionButtonChange'
    },
    initialize: function(){
      var textareaEvent = 'oninput' in document ? 'input' : 'keyup blur';

      S.TemplateHelpers.overridePlaceTypeConfig(this.options.placeConfig.items,
        this.options.defaultPlaceTypeName);
      S.TemplateHelpers.insertInputTypeFlags(this.options.placeConfig.items);

      // Rooms added with "+ Add another room", waiting for Post.
      this.kkRooms = [];

      // Bind model events
      this.model.on('error', this.onError, this);

      // Listen to input changes on textareas. If they have a maxlength, then
      // update the character count. If maxlength is not supported, then
      // polyfill.
      this.$el.on(textareaEvent, 'textarea', function(evt) {
        var $counter = $(this).siblings('.remaining-characters').children('.character-counter'),
            maxLen, curLen, remaining;

        if (this.hasAttribute('maxlength')) {
          maxLen = this.getAttribute('maxlength');
          curLen = this.value.length;
          remaining = maxLen - curLen;

          if (remaining <= 20) {
            $counter.parent('.remaining-characters').addClass('warning');

            if (remaining <= 0) {
              remaining = 0;
              this.value = this.value.substr(0, maxLen);
            }
          } else {
            $counter.parent('.remaining-characters').removeClass('warning');
          }

          $counter.text(remaining);
          return false;
        }
      });
    },
    getTemplateContext: function() {
      // Augment the model data with place types for the drop down
      const context = _.extend({
        place_config: this.options.placeConfig,
        user_token: this.options.userToken,
        language_code: S.bootstrapped.languageCode,
        current_user: S.currentUser
      }, S.Util.getStickyFields()[this.options.userToken] || {}, this.model.toJSON());

      return context;
    },
    render: function(){
      var context = this.getTemplateContext();

      this.$el.html(Handlebars.templates['place-form'](context));
      this.updatedRequiredOptionButtons();
      this.offerDraft();

      // Init counter text
      this.$('textarea').each(function() {
        var $counter = $(this).siblings('.remaining-characters').children('.character-counter');

        if (this.hasAttribute('maxlength')) {
          $counter.text(this.getAttribute('maxlength'));
        }
      });

      return this;
    },
    remove: function() {
      this.unbind();
    },
    onError: function(model, res) {
      // TODO handle model errors!
      console.log('oh no errors!!', model, res);
    },
    // This is called from the app view
    setLatLng: function(latLng) {
      this.center = latLng;
      this.$('.drag-marker-instructions, .drag-marker-warning').addClass('is-visuallyhidden');
    },
    setLocation: function(location) {
      // We want to make sure we don't give the user the impression that their
      // location is set when it isn't yet, so only update location-receivers
      // if the center has been set.
      if (this.center) {
        this.location = location;
        this.$('.location-receiver').html(location)
      }
    },
    // Get the attributes from the form
    getAttrs: function() {
      var attrs = {},
          locationAttr = this.options.placeConfig.location_item_name,
          $form = this.$('form');

      // Get values from the form
      attrs = S.Util.getAttrs($form);

      // Get the location attributes from the map
      attrs.geometry = {
        type: 'Point',
        coordinates: [this.center.lng, this.center.lat]
      };

      if (this.location && locationAttr) {
        attrs[locationAttr] = this.location;
      }

      return attrs;
    },
    // ---- photos ----------------------------------------------------------
    //
    // Up to MAX_PHOTOS, ADDED one pick at a time. 2026-10-12: a poster picked
    // two photos and only one was saved. Three things in the first version
    // could each do that, so all three are fixed here:
    //
    //  * A second tap on "Add photos" REPLACED the first pick. People add
    //    photos one at a time, so a new pick now adds to what is there, and
    //    "Remove" (beside the count) is how to start over.
    //  * Photos were shrunk all at once. Two full-size camera photos decoded
    //    together is how a phone runs out of memory and drops one without a
    //    word. They now go through a queue, one at a time.
    //  * Pressing Submit while photos were still being shrunk saved only the
    //    finished ones. Submit now waits ("Preparing photos...") and then
    //    saves - see onSubmit.
    //
    // Each photo is its own attachment, named my_image, my_image-2, ... -
    // attachments are matched by name, so distinct names are what keep them
    // separate. A photo the phone cannot read never calls back at all, so
    // each one has PHOTO_TIMEOUT_MS before it is counted as failed and the
    // queue moves on; otherwise one bad file would hold Submit forever.
    MAX_PHOTOS: 4,
    PHOTO_TIMEOUT_MS: 20000,

    photoNamesHeld: function(baseName) {
      return this.model.attachmentCollection.filter(function(model) {
        var n = model.get('name') || '';
        return n === baseName || n.indexOf(baseName + '-') === 0;
      });
    },

    freePhotoName: function(baseName) {
      var held = _.map(this.photoNamesHeld(baseName), function(m) { return m.get('name'); });
      for (var i = 1; i <= this.MAX_PHOTOS; i++) {
        var name = i === 1 ? baseName : baseName + '-' + i;
        if (!_.contains(held, name)) { return name; }
      }
      return null;
    },

    photosPending: function() {
      return !!this._photoBusy || !!(this._photoQueue && this._photoQueue.length);
    },

    onInputFileChange: function(evt) {
      var input = evt.target;
      if (!input.files || !input.files.length) { return; }

      var baseName = $(input).attr('name'),
          queue = this._photoQueue = this._photoQueue || [],
          held = this.photoNamesHeld(baseName).length + queue.length + (this._photoBusy ? 1 : 0),
          room = Math.max(0, this.MAX_PHOTOS - held),
          files = Array.prototype.slice.call(input.files, 0, room),
          maxHeight = parseInt(input.getAttribute("data-max-height")) || 800,
          maxWidth = parseInt(input.getAttribute("data-max-width")) || 800;

      this._photoBase = baseName;
      this._photoOver = input.files.length > files.length;
      _.each(files, function(file) {
        queue.push({ file: file, baseName: baseName, maxWidth: maxWidth, maxHeight: maxHeight });
      });
      // Empty the picker: the photos now live in the queue and the
      // attachment collection, and an emptied input fires `change` again
      // even when the same photo is picked a second time.
      try { input.value = ''; } catch (e) {}

      this.renderPhotoStatus();
      this.processNextPhoto();
    },

    processNextPhoto: function() {
      var self = this;
      if (self._photoBusy) { return; }
      var job = (self._photoQueue || []).shift();
      if (!job) {
        self.renderPhotoStatus();
        self.onPhotosReady();
        return;
      }
      self._photoBusy = true;
      self.renderPhotoStatus();

      var finished = false, timer;
      var done = function(data) {
        if (finished) { return; }
        finished = true;
        clearTimeout(timer);
        var name = data && self.freePhotoName(job.baseName);
        if (name) {
          data.name = name;
          self.model.attachmentCollection.add(data);
        } else if (!data) {
          self._photoFailed = (self._photoFailed || 0) + 1;
        }
        self._photoBusy = false;
        self.processNextPhoto();
      };
      timer = setTimeout(function() { done(null); }, self.PHOTO_TIMEOUT_MS);

      try {
        S.Util.fileToCanvas(job.file, function(canvas) {
          try {
            canvas.toBlob(function(blob) {
              if (!blob) { done(null); return; }
              done({ blob: blob, file: canvas.toDataURL('image/jpeg', S.JPEG_QUALITY) });
              // toBlob with no quality argument uses the browser's default,
              // which is 0.92 in every major browser. At the size this canvas
              // has already been reduced to, 0.82 is not distinguishable by
              // eye and is roughly a third fewer bytes - bytes the student
              // pays to upload on mobile data, and every visitor pays to
              // download.
            }, 'image/jpeg', S.JPEG_QUALITY);
          } catch (e) { done(null); }
        }, {
          maxWidth: job.maxWidth,
          maxHeight: job.maxHeight,
          canvas: true
        });
      } catch (e) { done(null); }
    },

    renderPhotoStatus: function() {
      var $name = this.$('.fileinput-name');
      if (!$name.length || !this._photoBase) { return; }
      var count = this.photoNamesHeld(this._photoBase).length,
          parts = [];
      if (this.photosPending()) {
        $name.text('Preparing photos…');
        return;
      }
      if (count) { parts.push(count === 1 ? '1 photo' : count + ' photos'); }
      if (this._photoOver) { parts.push('up to ' + this.MAX_PHOTOS); }
      if (this._photoFailed) {
        parts.push(this._photoFailed === 1 ? '1 could not be read' :
          this._photoFailed + ' could not be read');
      }
      $name.text(parts.join(' · '));
      if (count) {
        $name.append(' ').append(
          $('<a href="#" class="kk-photos-clear"></a>').text('Remove'));
      }
    },

    onClearPhotos: function(evt) {
      if (evt) { evt.preventDefault(); }
      var base = this._photoBase;
      if (!base) { return; }
      this._photoQueue = [];
      this._photoOver = false;
      this._photoFailed = 0;
      this.model.attachmentCollection.remove(this.photoNamesHeld(base));
      this.renderPhotoStatus();
    },

    // ---- several rooms from one form ------------------------------------
    //
    // "+ Add another room" puts this room into the list above the form and
    // keeps every field for the next one, clearing only the photos. A row can
    // stand for several identical rooms (the x N stepper), tapping a row
    // brings it back into the form to edit, and the list is kept on the phone
    // so a call or a reloaded tab does not lose it. Post then saves each room
    // on the same pin (saveRooms). See KK.rooms and KK.draft in the flavor's
    // custom.js for the why. Without the button, none of this runs and the
    // form saves one room exactly as before.

    // This room as typed: its fields, its photos, and the free-date answer.
    snapshotRoom: function() {
      var KK = window.KothaKhoj;
      return {
        attrs: S.Util.getAttrs(this.$('form')),
        photos: this.model.attachmentCollection.map(function(a) {
          return { name: a.get('name'), blob: a.get('blob'), file: a.get('file') };
        }),
        picker: (KK && KK.freePicker) ? KK.freePicker.snapshot(this.$('.free-picker')) : null,
        count: 1
      };
    },

    // Put a room back into the form: fields, free-date answer and photos.
    loadRoom: function(room) {
      var KK = window.KothaKhoj, form = this.$('form')[0];
      if (!form) { return; }
      _.each(room.attrs, function(value, name) {
        if (name === 'private-consent' || name === 'private-consent_version') { return; }
        _.each(form.querySelectorAll('[name="' + name + '"]'), function(el) {
          if (el.type === 'radio') { el.checked = (el.value === String(value)); }
          else if (el.type === 'checkbox') { el.checked = (value === el.value || value === 'on' || value === true); }
          else if (el.type !== 'file' && el.type !== 'submit') { el.value = value; }
        });
      });
      this.updatedRequiredOptionButtons();
      if (KK && KK.freePicker) { KK.freePicker.restore(this.$('.free-picker'), room.picker); }
      this.clearAllPhotos();
      _.each(room.photos, function(p) { this.model.attachmentCollection.add(_.clone(p)); }, this);
      this._photoBase = this._photoBase || 'my_image';
      this.renderPhotoStatus();
    },

    clearAllPhotos: function() {
      this._photoQueue = [];
      this._photoOver = false;
      this._photoFailed = 0;
      this.model.attachmentCollection.reset();
      this.renderPhotoStatus();
    },

    // The browser's own checks, for this room only - the consent line is a
    // promise made once, at Post, so it is not asked for here.
    roomIsComplete: function() {
      var form = this.$('form')[0];
      if (!form) { return false; }
      for (var i = 0; i < form.elements.length; i++) {
        var el = form.elements[i];
        if (!el.willValidate || el.name === 'private-consent') { continue; }
        if (!el.checkValidity()) {
          if (el.reportValidity) { el.reportValidity(); }
          return false;
        }
      }
      return true;
    },

    onAddRoom: function(evt) {
      if (evt) { evt.preventDefault(); }
      var KK = window.KothaKhoj;
      if (!KK || !KK.rooms) { return; }
      if (this.photosPending()) {
        KK.toast('Photos are still being prepared. Add the room in a moment.');
        return;
      }
      if (!this.roomIsComplete()) { return; }
      var room = this.snapshotRoom();
      // What the form holds right after this tap: compared against at Post,
      // so an untouched form is never mistaken for one more room. Not "the
      // last row in the list" - an edited room goes back to its old place.
      this._lastAdded = room;
      // A room brought back to edit goes back where it was, with its count.
      if (this._editing) {
        room.count = this._editing.count || 1;
        this.kkRooms.splice(Math.min(this._editing.index, this.kkRooms.length), 0, room);
        this._editing = null;
      } else {
        this.kkRooms.push(room);
      }
      // Every photo goes with the room just added - all of them, not only
      // those under the last picker's name (onClearPhotos clears by name, and
      // knows no name until a picker has been used). The next room starts
      // with none.
      this.clearAllPhotos();
      this.renderRooms();
      this.saveDraft();
      KK.toast('Room added. Fill in the next one, or Post.');
    },

    onRemoveRoom: function(evt) {
      evt.preventDefault();
      var i = parseInt($(evt.currentTarget).data('index'), 10);
      if (isFinite(i)) { this.kkRooms.splice(i, 1); }
      this.renderRooms();
      this.saveDraft();
    },

    onRoomLess: function(evt) { this.changeCount(evt, -1); },
    onRoomMore: function(evt) { this.changeCount(evt, +1); },
    changeCount: function(evt, by) {
      evt.preventDefault();
      var KK = window.KothaKhoj, i = parseInt($(evt.currentTarget).data('index'), 10),
          room = this.kkRooms[i];
      if (!room || !KK) { return; }
      room.count = Math.max(1, Math.min(KK.rooms.MAX_COUNT, (room.count || 1) + by));
      this.renderRooms();
      this.saveDraft();
    },

    // Bring a row back into the form. Whatever was being typed there is
    // replaced, so if it was a different room, ask first.
    onEditRoom: function(evt) {
      evt.preventDefault();
      var self = this, KK = window.KothaKhoj,
          i = parseInt($(evt.currentTarget).data('index'), 10),
          room = this.kkRooms[i];
      if (!room || !KK) { return; }
      var box = this.snapshotRoom(),
          last = this._lastAdded,
          go = function() {
            self.kkRooms.splice(i, 1);
            self._editing = { index: i, count: room.count || 1 };
            self.loadRoom(room);
            self.renderRooms();
            self.saveDraft();
            var top = self.$('.free-picker')[0];
            if (top && top.scrollIntoView) { top.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
            KK.toast('Change it, then tap "+ Add another room" to put it back.');
          };
      if (this._editing || KK.rooms.changed(box.attrs, box.photos.length, last)) {
        KK.confirm({
          title: 'Edit room ' + (i + 1) + '?',
          body: 'What is in the form now will be replaced. Add it first if it is a room you want.',
          okText: 'Edit room ' + (i + 1),
          cancelText: 'Keep typing'
        }).then(function(yes) { if (yes) { go(); } });
        return;
      }
      go();
    },

    renderRooms: function() {
      var KK = window.KothaKhoj, n = this.kkRooms.length,
          total = KK && KK.rooms ? KK.rooms.total(this.kkRooms) : n,
          $button = this.$('[name="save-place-btn"]');
      if (!KK || !KK.rooms) { return; }
      if (this._submitLabelDefault == null) { this._submitLabelDefault = $button.val(); }
      this.$('.kk-rooms-added').prop('hidden', n === 0);
      this.$('.kk-rooms-count').text(total);
      this.$('.kk-rooms-list').html(KK.rooms.listHtml(this.kkRooms));
      $button.val(n ? KK.rooms.postLabel(total) : this._submitLabelDefault);
    },

    // ---- the house in progress, kept on the phone ----------------------
    saveDraft: function() {
      var KK = window.KothaKhoj;
      if (!KK || !KK.draft) { return; }
      if (!this.kkRooms.length) { KK.draft.clear(); return; }
      KK.draft.save({
        savedAt: Date.now(),
        center: this.center ? { lat: this.center.lat, lng: this.center.lng } : null,
        location: this.location || '',
        rooms: this.kkRooms.map(function(r) {
          // The photo's text copy (file) is only a preview; the blob is what
          // uploads. Leaving it out halves what the phone has to store.
          return { attrs: r.attrs, picker: r.picker, count: r.count || 1,
                   photos: r.photos.map(function(p) { return { name: p.name, blob: p.blob }; }) };
        })
      });
    },

    offerDraft: function() {
      var self = this, KK = window.KothaKhoj;
      if (!KK || !KK.draft || !KK.confirm) { return; }
      KK.draft.load().then(function(draft) {
        if (!KK.draft.isFresh(draft)) { if (draft) { KK.draft.clear(); } return; }
        if (self.kkRooms.length) { return; }
        KK.confirm({
          title: 'Continue the house you started?',
          body: KK.draft.describe(draft),
          okText: 'Continue',
          cancelText: 'Start a new one'
        }).then(function(yes) {
          if (!yes) { KK.draft.clear(); return; }
          self._lastAdded = null;
          self.kkRooms = draft.rooms.map(function(r) {
            return { attrs: r.attrs, picker: r.picker, count: r.count || 1,
                     photos: r.photos.map(function(p) { return { name: p.name, blob: p.blob, file: '' }; }) };
          });
          var av = self.options.appView;
          if (draft.center && av && window.L) {
            var ll = window.L.latLng(draft.center.lat, draft.center.lng);
            if (av.mapView && av.mapView.map) {
              av.mapView.map.setView(ll, av.mapView.map.getMaxZoom() || 18);
            }
            av.setPlaceFormViewLatLng(ll);
            if (draft.location) { av.setPlaceFormViewLocation(draft.location); }
          }
          // Leave the form as "+ Add another room" would have: holding the
          // last room's details, photos cleared. An empty form would block
          // Post on its own required fields, and an untouched one is not
          // asked about.
          var last = self.kkRooms[self.kkRooms.length - 1];
          self.loadRoom({ attrs: last.attrs, picker: last.picker, photos: [] });
          self._lastAdded = self.snapshotRoom();
          self.renderRooms();
        });
      });
    },

    // ---- photos that really arrive --------------------------------------
    // Waits for this saved room's photos, one at a time with retries (see
    // PlaceModel.uploadPhotos), showing progress on the button. If some still
    // fail, says so and offers to try again - the room itself is already
    // saved, so continuing without them loses nothing else.
    uploadPhotosThen: function(model, label, done) {
      var self = this, KK = window.KothaKhoj,
          $button = this.$('[name="save-place-btn"]');
      if (!model.uploadPhotos) { done(); return; }
      model.uploadPhotos(function(i, n) {
        $button.val((label ? label + ' · ' : '') + 'Uploading photo ' + i + ' of ' + n + '…');
      }).then(function(failed) {
        if (!failed.length || !KK || !KK.confirm) { done(); return; }
        KK.confirm({
          title: failed.length === 1 ? 'A photo did not upload' : failed.length + ' photos did not upload',
          body: 'The room is saved, but the connection dropped while sending ' +
                (failed.length === 1 ? 'a photo' : 'some photos') + '. Try again now?',
          okText: 'Try again',
          cancelText: 'Continue without'
        }).then(function(again) {
          if (again) { self.uploadPhotosThen(model, label, done); } else { done(); }
        });
      });
    },

    // Save every room in the plan, one after another, on one pin, each with
    // its photos sent before the next room starts. Each room keeps its own
    // idempotency key and its saved id, so pressing Post again after a
    // dropped connection saves only the rooms still missing.
    saveRooms: function(rooms) {
      var self = this,
          places = this.model.collection,
          // Everything getAttrs adds beyond the form fields - the address
          // line, the device token custom.js attaches for shared accounts,
          // the consent - comes from one call, so a room saved from the list
          // carries exactly what a single room would.
          base = this.getAttrs(),
          at = this._houseTarget || this.center,
          geometry = { type: 'Point', coordinates: [at.lng, at.lat] },
          $button = this.$('[name="save-place-btn"]'),
          i = 0;

      $button.attr('disabled', 'disabled');
      this.spinner = new Spinner(S.smallSpinnerOptions).spin(this.$('.form-spinner')[0]);
      S.Util.log('USER', 'new-place', 'submit-rooms-btn-click');
      S.Util.setStickyFields(_.clone(rooms[0].attrs), S.Config.survey.items, S.Config.place.items);

      var next = function() {
        while (i < rooms.length && rooms[i].savedId && !rooms[i].photosPending) { i++; }
        if (i >= rooms.length) { self.onRoomsSaved(rooms); return; }
        var r = rooms[i], label = 'Room ' + (i + 1) + ' of ' + rooms.length;
        var afterSave = function() {
          self.uploadPhotosThen(r.model, label, function() {
            r.photosPending = false;
            i++;
            next();
          });
        };
        // Saved on an earlier try, photos not finished: only the photos.
        if (r.savedId) { afterSave(); return; }
        $button.val('Saving ' + label.toLowerCase() + '…');
        if (!r.model) {
          r.model = new S.PlaceModel(null, { collection: places });
          _.each(r.photos, function(p) { r.model.attachmentCollection.add(_.clone(p)); });
          r.key = S.Util.newAttemptKey();
        }
        var attrs = _.extend({}, base, r.attrs, {
          geometry: geometry,
          'private-consent': base['private-consent'],
          'private-consent_version': base['private-consent_version']
        });
        r.model.save(attrs, {
          headers: { 'X-KothaKhoj-Idempotency-Key': r.key },
          deferAttachments: true,
          wait: true,
          success: function() {
            r.savedId = r.model.id;
            r.photosPending = true;
            places.add(r.model);
            S.Util.addMyPlaceId(r.model.id);
            $(S).trigger('myplacesaved', [r.model]);
            afterSave();
          },
          error: function(m, response) {
            self.onSaveError(r.model, response);
            self.onSaveComplete();
            $button.val('Post the rooms not saved yet');
          }
        });
      };
      next();
    },

    onRoomsSaved: function(rooms) {
      var KK = window.KothaKhoj;
      this.onSaveComplete();
      this.kkRooms = [];
      this._roomsPlan = null;
      if (KK && KK.draft) { KK.draft.clear(); }
      S.Util.log('USER', 'new-place', 'successfully-add-rooms');
      if (KK && KK.toast) { KK.toast(rooms.length + ' rooms are on the map, as one house.'); }
      this.options.router.navigate('/place/' + rooms[0].savedId + '/new', {trigger: true});
    },

    // Called when the photo queue empties. If Submit was pressed while photos
    // were still being prepared, this is where that save actually happens.
    onPhotosReady: function() {
      if (!this._submitWhenReady) { return; }
      this._submitWhenReady = false;
      this.$('[name="save-place-btn"]')
        .val(this._submitLabel).removeAttr('disabled');
      this.submitRoom();
    },
    updatedRequiredOptionButtons: function(optionButtons) {
      var groupNames = []

      this.$(optionButtons || '[data-group-required]').each(function(index, btn) {
        groupNames.push($(btn).attr('name'));
      });

      _.chain(groupNames).uniq().each(function(groupName) {
        var groupOptions = this.$('[name="' + groupName + '"]');
        if (groupOptions.is(':checked')) {
          groupOptions.removeAttr('required');
        } else {
          groupOptions.attr('required', 'required');
        }
      }, this);
    },
    onRequiredOptionButtonChange: function(evt) {
      this.updatedRequiredOptionButtons(evt.currentTarget)
    },
    onSaveSuccess: function() {
      var router = this.options.router,
          model = this.model,
          newPlaceUrl = '/place/' + model.id + '/new';

      // The room exists. Anything typed after this is a different room and
      // must get its own key.
      this._attemptKey = null;

      // Remember this place as one of "mine" so it can be highlighted on the
      // map, and tell the map to repaint it gold right away.
      S.Util.addMyPlaceId(model.id);
      $(S).trigger('myplacesaved', [model]);

      // Redirect to the new-place page
      S.Util.log('USER', 'new-place', 'successfully-add-place');
      router.navigate(newPlaceUrl, {trigger: true});
    },
    onSaveError: function(model, response) {
      S.Util.log('USER', 'new-place', 'fail-to-add-place');
      // A failed save used to be completely silent: the spinner stopped and
      // nothing else happened, so a landlord who had typed out a whole room
      // just saw the button do nothing. Say what went wrong, and keep every
      // value they typed so they can fix it and press Save again.
      var status = (response && response.status) || 0;
      var expired = (status === 401 || status === 403);
      // The api refuses a room without both consent ticks (2026-10-12). The
      // form already requires them, so this mostly catches a page opened
      // before the boxes existed - which is why it says to reload.
      var body = (response && response.responseJSON) || {};
      var noConsent = (status === 400 && body.missing && body.missing.length);
      var message = expired ?
        'Your sign-in has expired. Sign in again, then press Save — nothing you typed has been lost.' :
        noConsent ?
        'Tick the box above Submit: that you are 18 or older and the owner agreed to this listing. If you cannot see it, reload the page.' :
        'Could not save this room just now. Check your internet and press Save again — nothing you typed has been lost.';
      var $form = this.$('#place-form');
      if (!$form.length) { $form = this.$el; }
      $form.find('.kk-save-error').remove();
      var $msg = $('<p class="kk-save-error"></p>').text(message);
      if (expired) {
        $msg.append(' ').append(
          $('<a href="/page/signin">Sign in</a>')
        );
      }
      $msg.prependTo($form);
      var el = $msg[0];
      if (el && el.scrollIntoView) {
        try { el.scrollIntoView({ block: 'center' }); } catch (e) { el.scrollIntoView(); }
      }
    },
    onSaveComplete: function() {
      var $button = this.$('[name="save-place-btn"]'),
          spinner = this.spinner;

      $button.removeAttr('disabled');
      if (spinner) {
        spinner.stop();
      }
    },
    onSubmit: Gatekeeper.onValidSubmit(function(evt) {
      // Make sure that the center point has been set after the form was
      // rendered. If not, this is a good indication that the user neglected
      // to move the map to set it in the correct location.
      if (!this.center) {
        this.$('.drag-marker-instructions').addClass('is-visuallyhidden');
        this.$('.drag-marker-warning').removeClass('is-visuallyhidden');

        // Scroll to the top of the panel if desktop
        this.$el.parent('article').scrollTop(0);
        // Scroll to the top of the window, if mobile
        window.scrollTo(0, 0);
        return;
      }

      if (evt) { evt.preventDefault(); }

      // Photos still being shrunk would be left out of the save (2026-10-12:
      // two picked, one saved). Wait for them, say so on the button, and
      // save from onPhotosReady.
      if (this.photosPending()) {
        var $wait = this.$('[name="save-place-btn"]');
        if (!this._submitWhenReady) { this._submitLabel = $wait.val(); }
        this._submitWhenReady = true;
        $wait.val('Preparing photos…').attr('disabled', 'disabled');
        return;
      }

      this.submitRoom();
    }),

    submitRoom: function() {
      // Same house? Asked once per form, before anything is saved: a room
      // added with "Add another room in this house", or one whose pin lands
      // within a few metres of a room already on the map, is saved on that
      // room's exact pin so the map shows them as one house. See KK.house
      // in the flavor's custom.js.
      var KK = window.KothaKhoj, self = this;
      if (KK && KK.house && !this._houseDecided) {
        if (this._houseAsking) { return; }
        this._houseAsking = true;
        var places = this.options.appView && this.options.appView.places,
            rooms = places ? places.filter(function(m) { return !m.isNew(); })
                                   .map(function(m) { return m.attributes; }) : [];
        KK.house.decide({ lat: this.center.lat, lng: this.center.lng }, this.kkHouse, rooms)
          .then(function(target) {
            self._houseTarget = target;
            self._houseDecided = true;
            self._houseAsking = false;
            self.submitRoom();
          });
        return;
      }

      // Several rooms: decide once whether the form's current contents are
      // one more room, then save them all. Untouched since the last "Add",
      // the form is just that room's details kept for convenience; changed,
      // the poster is asked, so nothing is saved twice or silently dropped.
      if ((this.kkRooms && this.kkRooms.length) || this._roomsPlan) {
        if (!this._roomsPlan) {
          if (!this._boxDecided) {
            var box = this.snapshotRoom(),
                last = this._lastAdded,
                n = KK.rooms.total(this.kkRooms);
            if (KK && KK.rooms && KK.rooms.changed(box.attrs, box.photos.length, last)) {
              if (this._boxAsking) { return; }
              this._boxAsking = true;
              KK.confirm({
                title: 'Add this room too?',
                body: KK.rooms.label(box.attrs, box.photos.length),
                okText: 'Yes, add it',
                cancelText: n === 1 ? 'No, only the 1 added' : 'No, only the ' + n + ' added'
              }).then(function(yes) {
                self._boxIncluded = yes;
                self._boxDecided = true;
                self._boxAsking = false;
                self.submitRoom();
              });
              return;
            }
            this._boxDecided = true;
            this._boxIncluded = false;
          }
          var plan = this.kkRooms.slice();
          if (this._boxIncluded) { plan.push(this.snapshotRoom()); }
          // One saved room per copy: a "x 3" row is three rooms.
          this._roomsPlan = KK.rooms.expand(plan);
        }
        this.saveRooms(this._roomsPlan);
        return;
      }

      var router = this.options.router,
          model = this.model,
          // Should not include any files
          attrs = this.getAttrs(),
          $button = this.$('[name="save-place-btn"]'),
          spinner, $fileInputs;

      if (this._houseTarget) {
        attrs.geometry.coordinates = [this._houseTarget.lng, this._houseTarget.lat];
      }

      $button.attr('disabled', 'disabled');
      this.spinner = new Spinner(S.smallSpinnerOptions).spin(this.$('.form-spinner')[0]);

      S.Util.log('USER', 'new-place', 'submit-place-btn-click');

      S.Util.setStickyFields(attrs, S.Config.survey.items, S.Config.place.items);

      // One key per room being composed, not per request.
      //
      // Minted on the first Save and kept until a save actually succeeds, so
      // a retry carries the SAME key and the server recognises it as the same
      // attempt rather than a second room. Deliberately not minted in
      // initialize() or render(): if this view were ever reused for a second
      // room, a key from the first would suppress the second one entirely -
      // a far worse bug than the duplicate it is meant to prevent.
      //
      // This is the other half of the fix. The error message tells the
      // student to "press Save again", which is right - but only safe
      // because the second press now says which attempt it belongs to.
      if (!this._attemptKey) {
        this._attemptKey = S.Util.newAttemptKey();
      }

      // Save, wait for the photos to really arrive, then go to the room.
      this.model.save(attrs, {
        headers: { 'X-KothaKhoj-Idempotency-Key': this._attemptKey },
        deferAttachments: true,
        success: () => {
          this.uploadPhotosThen(model, '', () => {
            this.onSaveComplete(model);
            this.onSaveSuccess(model);
          });
        },
        error: (m, response) => {
          this.onSaveError(model, response);
          this.onSaveComplete(model);
        },
        wait: true
      });
    }
  });

}(Shareabouts, jQuery, Shareabouts.Util.console));
