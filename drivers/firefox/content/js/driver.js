/**
 * Firefox driver
 */

(function() {
	//'use strict';

	if ( wappalyzer == null ) return;

	var w = wappalyzer, prefs, strings;

	const
		Cc = Components.classes,
		Ci = Components.interfaces
		;

	w.driver = {
		/**
		 * Log messages to console
		 */
		log: function(args) {
			if ( prefs != null && prefs.getBoolPref('debug') ) {
				Cc['@mozilla.org/consoleservice;1'].getService(Ci.nsIConsoleService).logStringMessage(args.message);
			}
		},

		/**
		 * Initialize
		 */
		init: function(callback) {
			var handler = function() {
				window.removeEventListener('load', handler, false);

				w.log('w.driver: browser window loaded');

				strings = document.getElementById('wappalyzer-strings');

				AddonManager.getAddonByID('wappalyzer@crunchlabz.com', function(addon) {
					// Load jQuery
					(function () {
						Cc['@mozilla.org/moz/jssubscript-loader;1'].getService(Ci.mozIJSSubScriptLoader).loadSubScript('chrome://wappalyzer/content/js/lib/jquery.min.js');
					})();

					// Preferences
					prefs = Cc['@mozilla.org/preferences-service;1'].getService(Ci.nsIPrefService).getBranch('extensions.wappalyzer.');

					container();

					bindings();

					// Version check
					addon.version = addon.version;

					if ( !prefs.getCharPref('version') ) {
						w.config.firstRun = true;
					} else if ( prefs.getCharPref('version') != addon.version ) {
						w.config.upgraded = true;
					}

					prefs.setCharPref('version', addon.version);

					// Listen for messages from content script
					messageManager.addMessageListener('wappalyzer', content);

					// Load content script
					messageManager.loadFrameScript('chrome://wappalyzer/content/js/content.js', true);

					gBrowser.addProgressListener({
						// Listen for location changes
						onLocationChange: function(progress, request, location, flags) {
							w.driver.displayApps();
						},

						// Get response headers
						onStateChange: function(progress, request, flags, status) {
							if ( request != null && flags & Ci.nsIWebProgressListener.STATE_STOP ) {
								if ( request.nsIHttpChannel && request.contentType == 'text/html' ) {
									if ( progress.currentURI && request.name == progress.currentURI.spec ) {
										var headers = new Object();

										request.nsIHttpChannel.visitResponseHeaders(function(header, value) {
											headers[header] = value;
										});

										w.analyze(progress.currentURI.host, progress.currentURI.spec, { headers: headers });
									}
								}
							}
						}
					});

					gBrowser.tabContainer.addEventListener('TabSelect', w.driver.displayApps, false);

					callback();
				});
			};

			window.addEventListener('load',   handler,        false);
			window.addEventListener('unload', w.driver.track, false);
		},

		/**
		 * Display apps
		 */
		displayApps: function() {
			var image, url = gBrowser.currentURI.spec.split('#')[0];

			$('#wappalyzer-container > image, #wappalyzer-menu > menuitem, #wappalyzer-menu > menuseparator').addClass('wappalyzer-remove');

			if ( w.detected[url] != null && w.detected[url].length ) {
				if ( !prefs.getBoolPref('showIcons') ) {
					image = $('<image/>').attr('src', 'chrome://wappalyzer/skin/images/icon_hot.png');

					$('#wappalyzer-container').prepend(image);
				}

				w.detected[url].map(function(app, i) {
					var j, cat, showCat, menuSeparator, menuItem;

					for ( i in w.apps[app].cats ) {
						showCat = false;

						try {
							showCat = prefs.getBoolPref('cat' + w.apps[app].cats[i]);
						} catch(e) { }

						if ( showCat ) {
							if ( prefs.getBoolPref('showIcons') ) {
								image = $('<image/>').attr('src', 'chrome://wappalyzer/skin/images/icons/' + app + '.png');

								$('#wappalyzer-container').prepend(image);
							}

							menuSeparator = $('<menuseparator/>');

							$('#wappalyzer-menu').append(menuSeparator);

							menuItem = $('<menuitem/>')
								.attr('class', 'wappalyzer-application menuitem-iconic')
								.attr('image', 'chrome://wappalyzer/skin/images/icons/' + app + '.png')
								.attr('label', app)
								;

							menuItem.bind('command', function() {
								w.driver.goToURL({ url: w.config.websiteURL + 'applications/' + app.toLowerCase().replace(/ /g, '-').replace(/[^\w]/g, '') });
							});

							$('#wappalyzer-menu').append(menuItem);

							for ( j in w.apps[app].cats ) {
								var cat = w.apps[app].cats[j];

								menuItem = $('<menuitem/>')
									.attr('class', 'wappalyzer-category')
									.attr('label', strings.getString('wappalyzer.cat' + cat))
									;

								menuItem.bind('command', function() {
									w.driver.goToURL({ url: w.config.websiteURL + 'categories/' + w.categories[cat] });
								});

								$('#wappalyzer-menu').append(menuItem);
							}

							break;
						}
					}
				});
			} else {
				image = $('<image/>').attr('src', 'chrome://wappalyzer/skin/images/icon.png');

				$('#wappalyzer-container').prepend(image);

				menuSeparator = $('<menuseparator/>');

				$('#wappalyzer-menu').append(menuSeparator);

				menuItem = $('<menuitem/>')
					.attr('disabled', 'true')
					.attr('label', strings.getString('wappalyzer.noAppsDetected'))
					;

				$('#wappalyzer-menu').append(menuItem);
			}

			$('.wappalyzer-remove').remove();
		},

		/**
		 * Go to URL
		 */
		goToURL: function(args) {
			gBrowser.selectedTab = gBrowser.addTab(args.url);
		},

		/**
		 * Anonymously track detected applications for research purposes
		 */
		ping: function() {
			if ( Object.keys(w.ping.hostnames).length && prefs.getBoolPref('tracking') ) {
				// Make POST request
				var request = new XMLHttpRequest();

				request.open('POST', w.config.websiteURL + 'ping/', true);

				request.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');

				request.onreadystatechange = function(e) {
					if ( request.readyState == 4 ) { w.log('w.driver.ping: status ' + request.status); }
				};

				request.send('json=' + encodeURIComponent(JSON.stringify(w.ping)));

				w.log('w.driver.ping: ' + JSON.stringify(w.ping));

				w.ping = {};
			}
		}
	};

	/**
	 * Content message listener
	 */
	function content(msg) {
		w.log('content.js');

		w.analyze(msg.json.hostname, msg.json.url, { html: msg.json.html, env: msg.json.env });

		msg = null;
	}

	/**
	 * Move container to address or addon bar
	 */
	function container() {
		if ( prefs.getBoolPref('addonBar') ) {
			$('#wappalyzer-container').prependTo($('#wappalyzer-addonbar'));

			$('#wappalyzer-addonbar').show();
		} else {
			$('#wappalyzer-container').prependTo($('#urlbar-icons'));

			$('#wappalyzer-addonbar').hide();
		}
	}

	/**
	 * Bindings
	 */
	function bindings() {
		// Menu items
		var prefix = '#wappalyzer-menu-';

		$(prefix + 'icons')
			.attr('checked', prefs.getBoolPref('showIcons') ? 'true' : 'false')
			.bind('command', function() {
				prefs.setBoolPref('showIcons', !prefs.getBoolPref('showIcons'));

				$(this).attr('checked', prefs.getBoolPref('showIcons') ? 'true' : 'false');

				w.driver.displayApps();
			});

		$(prefix + 'preferences'  )
			.bind('command', function() {
				w.driver.goToURL({ url: 'chrome://wappalyzer/content/xul/preferences.xul' })
			});

		$(prefix + 'addonbar'  )
			.attr('checked', prefs.getBoolPref('addonBar') ? 'true' : 'false')
			.bind('command', function() {
				prefs.setBoolPref('addonBar', !prefs.getBoolPref('addonBar'));

				$(this).attr('checked', prefs.getBoolPref('addonBar') ? 'true' : 'false');

				container();

				if ( prefs.getBoolPref('addonBar') ) {
					alert(strings.getString('wappalyzer.addonBar'));
				}
			});

		$(prefix + 'feedback')
			.bind('command', function() {
				w.driver.goToURL({ url: w.config.websiteURL + 'contact' })
			});

		$(prefix + 'website')
			.bind('command', function() {
				w.driver.goToURL({ url: w.config.websiteURL })
			});

		$(prefix + 'github' )
			.bind('command', function() {
				w.driver.goToURL({ url: w.config.githubURL })
			});

		$(prefix + 'twitter')
			.bind('command', function() {
				w.driver.goToURL({ url: w.config.twitterURL})
			});
	}

	w.init();
})();
