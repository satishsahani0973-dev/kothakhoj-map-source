# KothaKhoj map: browser source

The source code of everything [kothakhoj.com](https://kothakhoj.com) sends to
a visitor's browser: the JavaScript, the page templates, the styles and
images, and the build that bundles them.

KothaKhoj is a room-finding map for students in Butwal, Nepal, run by Nepal
Kotha Khoj. It is a modified version of
[Shareabouts](https://github.com/openplans/shareabouts) by OpenPlans, changed
for KothaKhoj since July 2026. Like Shareabouts, it is free software
under the GNU General Public License, version 3 or later (see
[LICENSE.txt](LICENSE.txt)), and it comes with ABSOLUTELY NO WARRANTY.

Each commit here is one version of the site. The newest one matches what is
live.

## Building

    npm install

This installs Grunt and runs it (see `Gruntfile.js`). Grunt writes the bundles
that the pages load into `src/sa_web/static/dist/`.

## What is not here

The server side is not here: the Python that runs only on our server, and the
site's settings. GPL v3 asks for source to come with every copy of a program
that is passed on, and a website passes on only what the browser downloads.
The licence says this directly: "Mere interaction with a user through a
computer network, with no transfer of a copy, is not conveying."

The libraries in `src/sa_web/static/libs/` and
`src/flavors/satish/static/libs/` belong to their own authors. Each keeps its
own licence (MIT, BSD, Apache and others), stated inside the file.
