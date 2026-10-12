/*globals _ Spinner Handlebars Backbone jQuery Gatekeeper */

var Shareabouts = Shareabouts || {};

(function(S, $, console){
  S.PlaceFormView = Backbone.View.extend({
    // View responsible for the form for adding and editing places.
    events: {
      'submit form': 'onSubmit',
      'change input[type="file"]': 'onInputFileChange',
      'click .kk-photos-clear': 'onClearPhotos',
      'change [data-group-required]': 'onRequiredOptionButtonChange'
    },
    initialize: function(){
      var textareaEvent = 'oninput' in document ? 'input' : 'keyup blur';

      S.TemplateHelpers.overridePlaceTypeConfig(this.options.placeConfig.items,
        this.options.defaultPlaceTypeName);
      S.TemplateHelpers.insertInputTypeFlags(this.options.placeConfig.items);

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
      var router = this.options.router,
          model = this.model,
          // Should not include any files
          attrs = this.getAttrs(),
          $button = this.$('[name="save-place-btn"]'),
          spinner, $fileInputs;

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

      // Save and redirect
      this.model.save(attrs, {
        headers: { 'X-KothaKhoj-Idempotency-Key': this._attemptKey },
        success: () => { this.onSaveSuccess(model); },
        error: (m, response) => { this.onSaveError(model, response); },
        complete: () => { this.onSaveComplete(model); },
        wait: true
      });
    }
  });

}(Shareabouts, jQuery, Shareabouts.Util.console));
