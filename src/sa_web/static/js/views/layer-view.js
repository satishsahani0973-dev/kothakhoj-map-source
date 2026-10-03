/*globals L Backbone _ jQuery */

var Shareabouts = Shareabouts || {};

(function(S, $, console){
  S.LayerView = Backbone.View.extend({
     // A view responsible for the representation of a place on the map.
    initialize: function(){
      this.map = this.options.map;
      this.isFocused = false;

      // A throttled version of the render function
      this.throttledRender = _.throttle(this.render, 300);

      // Bind model events
      this.model.on('change', this.updateLayer, this);
      this.model.on('focus', this.focus, this);
      this.model.on('unfocus', this.unfocus, this);

      if (this.options.clustered) {
        // The cluster group already keeps only what is on screen, and
        // rebuilding every pin on every zoom would re-cluster the whole map
        // each time - so rebuild a pin only when the rule it matches changes.
        this.map.on('zoomend', this.refreshIfRuleChanged, this);
      } else {
        this.map.on('zoomend', this.updateLayer, this);

        // On map move, adjust the visibility of the markers for max efficiency
        this.map.on('move', this.throttledRender, this);
      }

      this.initLayer();
    },
    initLayer: function() {
      var geom, context;

      // Handle if an existing place type does not match the list of available
      // place types.
      this.placeType = this.options.placeTypes[this.model.get('location_type')];
      if (!this.placeType) {
        console.warn('Place type', this.model.get('location_type'),
          'is not configured so it will not appear on the map.');
        return;
      }

      // Don't draw new places. They are shown by the centerpoint in the app view
      if (!this.model.isNew()) {

        // Determine the style rule to use based on the model data and the map
        // state.
        context = this.styleContext();
        this.styleRule = L.Argo.getStyleRule(context, this.placeType.rules);

        // Construct an appropriate layer based on the model geometry and the
        // style rule. If the place is focused, use the 'focus_' portion of
        // the style rule if it exists.
        // Is this one of the current user's own places? If so, render it in
        // gold so they can spot their own places at a glance.
        var isMine = S.Util.isMyPlace(this.model, this.options.userToken);

        geom = this.model.get('geometry');
        if (geom.type === 'Point') {
          this.latLng = L.latLng(geom.coordinates[1], geom.coordinates[0]);
          if (this.hasIcon()) {
            var iconDef = (this.isFocused && this.styleRule.focus_icon) ?
              this.styleRule.focus_icon : this.styleRule.icon;
            if (isMine) {
              // Clone the icon definition (don't mutate the shared config) and
              // swap the image for the gold one of the same shape:
              // dot-2654d2.svg -> dot-gold.svg, pin-8a1538.svg -> pin-gold.svg.
              iconDef = _.extend({}, iconDef, {
                iconUrl: iconDef.iconUrl.replace(/-[0-9a-f]{6}\./, '-gold.')
              });
            }
            // The room being looked at is drawn above every other pin. Leaflet
            // stacks markers by latitude, so without this a neighbour just
            // south of it covered the big teardrop's head.
            this.layer = L.marker(this.latLng, {
              icon: L.icon(iconDef),
              alt: this.placeType.label,
              zIndexOffset: this.isFocused ? 1000 : 0
            });
          } else if (this.hasStyle()) {
            var styleDef = (this.isFocused && this.styleRule.focus_style) ?
              this.styleRule.focus_style : this.styleRule.style;
            if (isMine) {
              styleDef = _.extend({}, styleDef, {color: '#E0A400', fillColor: '#E0A400'});
            }
            this.layer = L.circleMarker(this.latLng, {...styleDef, alt: this.placeType.label});
          }
        } else {
          this.layer = L.GeoJSON.geometryToLayer(geom);
          this.layer.setStyle(this.styleRule.style);
        }

        // Focus on the layer onclick
        if (this.layer) {
          this.layer.on('click', this.onMarkerClick, this);

          // Label the user's own places with a small "Yours" tag.
          if (isMine && this.layer.bindTooltip) {
            this.layer.bindTooltip('Yours', {
              permanent: true,
              direction: 'top',
              offset: [0, -8],
              className: 'my-place-tooltip'
            });
          }
        }

        this.render();
      }
    },
    styleContext: function() {
      return _.extend({},
        this.model.toJSON(),
        {map: {zoom: this.map.getZoom()}},
        {layer: {focused: this.isFocused}});
    },
    updateLayer: function() {
      // Update the marker layer if the model changes and the layer exists
      this.removeLayer();
      this.initLayer();
    },
    refreshIfRuleChanged: function() {
      // The clustered stand-in for rebuilding on every zoomend. A rule can
      // depend on the zoom, and on the clock - "free later" becomes
      // "available now" once its date passes - so it is still re-checked on
      // every zoom; only a pin whose matched icon actually changed is
      // rebuilt. getStyleRule returns a fresh object each call but hands back
      // the config's own icon object, so comparing icons is comparing rules.
      // Rules that style by colour rather than icon rebuild every time, as
      // they did before.
      if (!this.placeType || this.model.isNew()) { return; }
      var next = L.Argo.getStyleRule(this.styleContext(), this.placeType.rules),
          prevIcon = this.styleRule && this.styleRule.icon;
      if (next && next.icon && prevIcon && next.icon === prevIcon) { return; }
      this.updateLayer();
    },
    removeLayer: function() {
      if (this.layer) {
        if (this.onMapDirectly) {
          this.map.removeLayer(this.layer);
          this.onMapDirectly = false;
        } else {
          this.options.placeLayers.removeLayer(this.layer);
        }
      }
    },
    render: function() {
      // Clustered, the cluster group decides what is on screen, so every pin
      // is simply handed to it.
      if (this.options.clustered) {
        this.show();
        return;
      }

      // Show if it is within the current map bounds
      var mapBounds = this.map.getBounds();

      if (this.latLng) {
        if (mapBounds.contains(this.latLng)) {
          this.show();
        } else {
          this.hide();
        }
      } else {
        this.show();
      }
    },
    onMarkerClick: function() {
      S.Util.log('USER', 'map', 'place-marker-click', this.model.getLoggingDetails());
      this.options.router.navigate('/place/' + this.model.id, {trigger: true});
    },

    isPoint: function() {
      return this.model.get('geometry').type == 'Point';
    },
    hasIcon: function() {
      return this.styleRule && this.styleRule.icon;
    },
    hasStyle: function() {
      return this.styleRule && this.styleRule.style;
    },

    focus: function() {
      if (!this.isFocused) {
        this.isFocused = true;
        this.updateLayer();
      }
    },
    unfocus: function() {
      if (this.isFocused) {
        this.isFocused = false;
        this.updateLayer();
      }
    },
    remove: function() {
      this.removeLayer();
      // Every listener, not only 'move'. A removed room's view used to keep
      // its zoomend and model handlers, so the next zoom rebuilt its pin and
      // put a room that had left the map straight back on it.
      this.map.off('move', this.throttledRender, this);
      this.map.off('zoomend', this.updateLayer, this);
      this.map.off('zoomend', this.refreshIfRuleChanged, this);
      this.model.off(null, null, this);
    },
    setIcon: function(icon) {
      if (this.layer) {
        this.layer.setIcon(icon);
      }
    },
    getLocationTypeFilter: function() {
      return this.options.mapView && this.options.mapView.locationTypeFilter;
    },
    show: function() {
      var locationTypeFilter = this.getLocationTypeFilter();
      var locationType = this.model.get('location_type');
      if (!locationTypeFilter || locationTypeFilter.toUpperCase() === locationType.toUpperCase()) {
        if (this.layer) {
          if (this.options.clustered && this.isFocused) {
            // The room being looked at is never folded into a cluster. It
            // goes on the map itself, so its teardrop shows at any zoom and
            // a shared room link always lands on a visible room.
            this.map.addLayer(this.layer);
            this.onMapDirectly = true;
          } else {
            this.options.placeLayers.addLayer(this.layer);
          }
          if (this.layer.bringToBack && !this.isFocused) {
            this.layer.bringToBack();
          }
        }
      } else {
        this.hide();
      }

    },
    hide: function() {
      this.removeLayer();
    }
  });

}(Shareabouts, jQuery, Shareabouts.Util.console));
