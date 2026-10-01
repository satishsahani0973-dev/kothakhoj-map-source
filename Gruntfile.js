module.exports = function(grunt) {

  grunt.initConfig({
    dirs: {
      // Configurable paths
      src: 'src/sa_web/static',
      dest: 'src/sa_web/static/dist'
    },

    // The GPL notice rides on the built javascript, because the javascript is
    // the only part of this that is actually DISTRIBUTED.
    //
    // Running a GPL v3 program as a website conveys nothing - the licence
    // says so in as many words: "Mere interaction with a user through a
    // computer network, with no transfer of a copy, is not conveying." The
    // Python never leaves the server, so none of it is covered.
    //
    // But every visitor's browser downloads these bundles, and that IS a
    // transfer of a copy. Concatenated and minified, they are "object code"
    // under section 6, which asks that the Corresponding Source be offered
    // to whoever receives them. The banner does that: it names the upstream
    // project, the licence, and where the source lives.
    //
    // A comment, not a page. The licence asks for the source to be
    // AVAILABLE to people who receive the code, never for a credit in the
    // interface - so this sits where a developer reading the file will find
    // it and a student never will.
    //
    // This only works while the repository below is PUBLIC. Make it private
    // and the offer stops being real. It holds only what browsers receive,
    // and scripts/publish-source.sh refreshes it on every deploy; this
    // repository, server code and all, is private.
    licenceBanner: '/*!\n' +
      ' * KothaKhoj - a room-finding map for Butwal, Nepal.\n' +
      ' * Built on Shareabouts (https://github.com/openplans/shareabouts).\n' +
      ' *\n' +
      ' * This file is free software under the GNU General Public License,\n' +
      ' * version 3 or later. It comes with ABSOLUTELY NO WARRANTY.\n' +
      ' *\n' +
      ' * Corresponding Source for this and every other file served here:\n' +
      ' *   https://github.com/satishsahani0973-dev/kothakhoj-map-source\n' +
      ' *\n' +
      ' * Licence text: https://www.gnu.org/licenses/gpl-3.0.txt\n' +
      ' */\n',

    concat: {
      distjs: {
        options: {separator: ';', banner: '<%= licenceBanner %>'},
        files: {
          '<%= dirs.dest %>/preload.js': ['<%= dirs.src %>/js/utils.js',
                                          '<%= dirs.src %>/js/template-helpers.js'],
          '<%= dirs.dest %>/app.js':     ['<%= dirs.src %>/js/handlebars-helpers.js',
                                          '<%= dirs.src %>/js/models.js',
                                          '<%= dirs.src %>/js/views/pages-nav-view.js',
                                          '<%= dirs.src %>/js/views/auth-nav-view.js',
                                          '<%= dirs.src %>/js/views/activity-view.js',
                                          '<%= dirs.src %>/js/views/app-view.js',
                                          '<%= dirs.src %>/js/views/layer-view.js',
                                          '<%= dirs.src %>/js/views/map-view.js',
                                          '<%= dirs.src %>/js/views/support-view.js',
                                          '<%= dirs.src %>/js/views/survey-view.js',
                                          '<%= dirs.src %>/js/views/place-detail-view.js',
                                          '<%= dirs.src %>/js/views/place-form-view.js',
                                          '<%= dirs.src %>/js/views/place-list-view.js',
                                          '<%= dirs.src %>/js/views/geocode-address-view.js',
                                          '<%= dirs.src %>/js/routes.js']
        }
      },
      distcss: {
        options: {separator: '\n'},
        files: {
          '<%= dirs.dest %>/app.css': ['<%= dirs.src %>/css/normalize.css',
                                       '<%= dirs.src %>/css/default.css',
                                       '<%= dirs.src %>/css/custom.css']
        }
      }
    },

    // No banner here, deliberately. uglify builds ONLY libs.min.js, and that
    // is underscore, backbone, marionette, handlebars, moment and the rest -
    // other people's MIT and BSD code. Stamping "this file is GPL v3" across
    // it would be stating someone else's licence wrongly, which is a worse
    // thing to do than the omission it would be fixing. Those libraries
    // carry their own notices inside them.
    uglify: {
      distjs: {
        files: {
          '<%= dirs.dest %>/libs.min.js': ['<%= dirs.src %>/libs/underscore.js',
                                           '<%= dirs.src %>/libs/backbone.js',
                                           '<%= dirs.src %>/libs/backbone.marionette.js',
                                           '<%= dirs.src %>/libs/handlebars-v3.0.3.js',
                                           '<%= dirs.src %>/libs/moment.min.js',
                                           '<%= dirs.src %>/libs/json2.js',
                                           '<%= dirs.src %>/libs/leaflet.argo.js',
                                           '<%= dirs.src %>/libs/binaryajax.js',
                                           '<%= dirs.src %>/libs/exif.js',
                                           '<%= dirs.src %>/libs/load-image.js',
                                           '<%= dirs.src %>/libs/canvas-to-blob.js',
                                           '<%= dirs.src %>/libs/spin.min.js',
                                           '<%= dirs.src %>/libs/gatekeeper.js',
                                           '<%= dirs.src %>/libs/swag.min.js',
                                           '<%= dirs.src %>/libs/jquery.scrollTo.js',
                                           '<%= dirs.src %>/libs/handlebars-helpers.js']
        }
      }
    },

    copy: {
      distcssimages: {
        expand: true,
        cwd: '<%= dirs.src %>/css/',
        src: '{,*/}*.{gif,jpeg,jpg,png,svg,webp}',
        dest: '<%= dirs.dest %>/',
      },
    },

    watch: {
      files: ['<%= jshint.files %>'],
      tasks: ['jshint']
    }
  });

  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-copy');

  grunt.registerTask('default', [
    'concat',
    'uglify',
    'copy'
  ]);

};