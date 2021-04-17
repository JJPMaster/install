( function () {
    // An mw.Api object
    var api;

    // Keep "common" at beginning
    var SKINS = [ "common", "monobook", "minerva", "vector", "cologneblue", "timeless" ];

    // How many scripts do we need before we show the quick filter?
    var NUM_SCRIPTS_FOR_SEARCH = 5;

    // The master import list, keyed by target. (A "target" is a user JS subpage
    // where the script is imported, like "common" or "vector".) Set in buildImportList
    var imports = {};

    // Local scripts, keyed on name; value will be the target. Set in buildImportList.
    var localScriptsByName = {};

    // How many scripts are installed?
    var scriptCount = 0;

    // Goes on the end of edit summaries
    var ADVERT = " ([[User:JJPMaster/install.js|script-installer]])";

    /**
     * Strings, for translation
     */
    var STRINGS = {
        installSummary: "Installing $1",
        installLinkText: "Install",
        installProgressMsg: "Installing...",
        uninstallSummary: "Uninstalling $1",
        uninstallLinkText: "Uninstall",
        uninstallProgressMsg: "Uninstalling...",
        disableSummary: "Disabling $1",
        disableLinkText: "Disable",
        disableProgressMsg: "Disabling...",
        enableSummary: "Enabling $1",
        enableLinkText: "Enable",
        enableProgressMsg: "Enabling...",
        moveLinkText: "Move",
        moveProgressMsg: "Moving...",
        movePrompt: "Destination? Enter one of:", // followed by the names of skins
        normalizeSummary: "Normalizing script installs",
        remoteUrlDesc: "$1, loaded from $2",
        panelHeader: "You currently have the following scripts installed",
        cannotInstall: "Cannot install",
        cannotInstallSkin: "This page is one of your user customization pages, and may (will, if common.js) already run on each page load.",
        cannotInstallContentModel: "Page content model is $1, not 'javascript'",
        insecure: "(insecure)", // used at the end of some messages
        notJavaScript: "not JavaScript",
        installViaPreferences: "Install via preferences",
        showNormalizeLinks: 'Show "normalize" links?',
        showMoveLinks: 'Show "move" links?',
        quickFilter: "Quick filter:",
        tempWarning: "Installation of non-User, non-MediaWiki protected pages is temporary and may be removed in the future.",
        badPageError: "Page is not User: or MediaWiki: and is unprotected",
        manageUserScripts: "Manage user scripts",
        bigSecurityWarning: "Warning! All user scripts could contain malicious content capable of compromising your account. Installing a script means it could be changed by others; make sure you trust its author. If you're unsure whether a script is safe, check at the technical village pump. Install this script? (Hide this dialog next time with sciNoConfirm=true; in your common.js.)"
    };

    var USER_NAMESPACE_NAME = mw.config.get( "wgFormattedNamespaces" )[2];

    /**
     * Constructs an Import. An Import is a line in a JS file that imports a
     * user script. Properties:
     *
     *  - "page" is a page name, such as "User:Foo/Bar.js".
     *  - "wiki" is a wiki from which the script is loaded, such as
     *    "en.wikipedia". If null, the script is local, on the user's
     *    wiki.
     *  - "url" is a URL that can be passed into mw.loader.load.
     *  - "target" is the title of the user subpage where the script is,
     *    without the .js ending: for example, "common".
     *  - "disabled" is whether this import is commented out.
     *  - "type" is 0 if local, 1 if remotely loaded, and 2 if URL.
     *
     * EXACTLY one of "page" or "url" are null for every Import. This
     * constructor should not be used directly; use the factory
     * functions (Import.ofLocal, Import.ofUrl, Import.fromJs) instead.
     */
    function Import( page, wiki, url, target, disabled ) {
        this.page = page;
        this.wiki = wiki;
        this.url = url;
        this.target = target;
        this.disabled = disabled;
        this.type = this.url ? 2 : ( this.wiki ? 1 : 0 );
    }

    Import.ofLocal = function ( page, target, disabled ) {
        if( disabled === undefined ) disabled = false;
        return new Import( page, null, null, target, disabled );
    }

    /** URL to Import. Assumes wgScriptPath is "/w" */
    Import.ofUrl = function ( url, target, disabled ) {
        if( disabled === undefined ) disabled = false;
        var URL_RGX = /^(?:https?:)?\/\/(.+?)\.org\/w\/index\.php\?.*?title=(.+?(?:&|$))/;
        var match;
        if( match = URL_RGX.exec( url ) ) {
            var title = decodeURIComponent( match[2].replace( /&$/, "" ) ),
                wiki = match[1];
            return new Import( title, wiki, null, target, disabled );
        }
        return new Import( null, null, url, target, disabled );
    }

    Import.fromJs = function ( line, target ) {
        var IMPORT_RGX = /^\s*(\/\/)?\s*importScript\s*\(\s*(?:"|')(.+?)(?:"|')\s*\)/;
        var match;
        if( match = IMPORT_RGX.exec( line ) ) {
            return Import.ofLocal( match[2], target, !!match[1] );
        }

        var LOADER_RGX = /^\s*(\/\/)?\s*mw\.loader\.load\s*\(\s*(?:"|')(.+?)(?:"|')\s*\)/;
        if( match = LOADER_RGX.exec( line ) ) {
            return Import.ofUrl( match[2], target, !!match[1] );
        }
    }

    Import.prototype.getDescription = function ( useWikitext ) {
        switch( this.type ) {
            case 0: return useWikitext ? ( "[[" + this.page + "]]" ) : this.page;
            case 1: return STRINGS.remoteUrlDesc.replace( "$1", this.page ).replace( "$2", this.wiki );
            case 2: return this.url;
        }
    }

    /**
     * Human-readable (NOT necessarily suitable for ResourceLoader) URL.
     */
    Import.prototype.getHumanUrl = function () {
        switch( this.type ) {
            case 0: return "/wiki/" + encodeURI( this.page );
            case 1: return "//" + this.wiki + ".org/wiki/" + encodeURI( this.page );
            case 2: return this.url;
        }
    }

    Import.prototype.toJs = function () {
        var dis = this.disabled ? "//" : "",
            url = this.url;
        switch( this.type ) {
            case 0: return dis + "mw.loader.load('//en.uncyclopedia.co/w/index.php?title=" + this.page + "&action=raw&ctype=text/javascript'); // Backlink: [[" + this.page + "]]";
            case 1: url = "//" + this.wiki + ".org/w/index.php?title=" +
                            this.page + "&action=raw&ctype=text/javascript"; 
                    /* FALL THROUGH */
            case 2: return dis + "mw.loader.load('" + url + "');";
        }
    }

    /**
     * Installs the import.
     */
    Import.prototype.install = function () {
        return api.postWithEditToken( {
            action: "edit",
            title: getFullTarget( this.target ),
            summary: STRINGS.installSummary.replace( "$1", this.getDescription( /* useWikitext */ true ) ) + ADVERT,
            appendtext: "\n" + this.toJs()
        } );
    }

    /**
     * Get all line numbers from the target page that mention
     * the specified script.
     */
    Import.prototype.getLineNums = function ( targetWikitext ) {
        function quoted( s ) {
            return new RegExp( "(['\"])" + escapeForRegex( s ) + "\\1" );
        }
        var toFind;
        switch( this.type ) {
            case 0: toFind = quoted( this.page ); break;
            case 1: toFind = new RegExp( escapeForRegex( this.wiki ) + ".*?" +
                            escapeForRegex( this.page ) ); break;
            case 2: toFind = quoted( this.url ); break;
        }
        var lineNums = [], lines = targetWikitext.split( "\n" );
        for( var i = 0; i < lines.length; i++ ) {
            if( toFind.test( lines[i] ) ) {
                lineNums.push( i );
            }
        }
        return lineNums;
    }

    /**
     * Uninstalls the given import. That is, delete all lines from the
     * target page that import the specified script.
     */
    Import.prototype.uninstall = function () {
        var that = this;
        return getWikitext( getFullTarget( this.target ) ).then( function ( wikitext ) {
            var lineNums = that.getLineNums( wikitext ),
                newWikitext = wikitext.split( "\n" ).filter( function ( _, idx ) {
                    return lineNums.indexOf( idx ) < 0;
                } ).join( "\n" );
            return api.postWithEditToken( {
                action: "edit",
                title: getFullTarget( that.target ),
                summary: STRINGS.uninstallSummary.replace( "$1", that.getDescription( /* useWikitext */ true ) ) + ADVERT,
                text: newWikitext
            } );
        } );
    }

    /**
     * Sets whether the given import is disabled, based on the provided
     * boolean value.
     */
    Import.prototype.setDisabled = function ( disabled ) {
        var that = this;
        this.disabled = disabled;
        return getWikitext( getFullTarget( this.target ) ).then( function ( wikitext ) {
            var lineNums = that.getLineNums( wikitext ),
                newWikitextLines = wikitext.split( "\n" );

            if( disabled ) {
                lineNums.forEach( function ( lineNum ) {
                    if( newWikitextLines[lineNum].trim().indexOf( "//" ) != 0 ) {
                        newWikitextLines[lineNum] = "//" + newWikitextLines[lineNum].trim();
                    }
                } );
            } else {
                lineNums.forEach( function ( lineNum ) {
                    if( newWikitextLines[lineNum].trim().indexOf( "//" ) == 0 ) {
                        newWikitextLines[lineNum] = newWikitextLines[lineNum].replace( /^\s*\/\/\s*/, "" );
                    }
                } );
            }

            var summary = ( disabled ? STRINGS.disableSummary : STRINGS.enableSummary )
                    .replace( "$1", that.getDescription( /* useWikitext */ true ) ) + ADVERT;
            return api.postWithEditToken( {
                action: "edit",
                title: getFullTarget( that.target ),
                summary: summary,
                text: newWikitextLines.join( "\n" )
            } );
        } );
    }

    Import.prototype.toggleDisabled = function () {
        this.disabled = !this.disabled;
        return this.setDisabled( this.disabled );
    }

    /**
     * Move this import to another file.
     */
    Import.prototype.move = function ( newTarget ) {
        if( this.target === newTarget ) return;
        var old = new Import( this.page, this.wiki, this.url, this.target, this.disabled );
        this.target = newTarget;
        return $.when( old.uninstall(), this.install() );
    }

    function getAllTargetWikitexts() {
        return $.getJSON(
            mw.util.wikiScript( "api" ),
            {
                format: "json",
                action: "query",
                prop: "revisions",
                rvprop: "content",
                rvslots: "main",
                titles: SKINS.map( getFullTarget ).join( "|" )
            }
        ).then( function ( data ) {
            if( data && data.query && data.query.pages ) {
                var result = {};
                    prefixLength = mw.config.get( "wgUserName" ).length + 6;
                Object.values( data.query.pages ).forEach( function ( moreData ) {
                    var nameWithoutExtension = new mw.Title( moreData.title ).getNameText();
                    var targetName = nameWithoutExtension.substring( nameWithoutExtension.indexOf( "/" ) + 1 );
                    result[targetName] = moreData.revisions ? moreData.revisions[0].slots.main["*"] : null;
                } );
                return result;
            }
        } );
    }

    function buildImportList() {
        return getAllTargetWikitexts().then( function ( wikitexts ) {
            Object.keys( wikitexts ).forEach( function ( targetName ) {
                var targetImports = [];
                if( wikitexts[ targetName ] ) {
                    var lines = wikitexts[ targetName ].split( "\n" );
                    var currImport;
                    for( var i = 0; i < lines.length; i++ ) {
                        if( currImport = Import.fromJs( lines[i], targetName ) ) {
                            targetImports.push( currImport );
                            scriptCount++;
                            if( currImport.type === 0 ) {
                                if( !localScriptsByName[ currImport.page ] )
                                    localScriptsByName[ currImport.page ] = [];
                                localScriptsByName[ currImport.page ].push( currImport.target );
                            }
                        }
                    }
                }
                imports[ targetName ] = targetImports;
            } );
        } );
    }


    /*
     * "Normalizes" (standardizes the format of) lines in the given
     * config page.
     */
    function normalize( target ) {
        return getWikitext( getFullTarget( target ) ).then( function ( wikitext ) {
            var lines = wikitext.split( "\n" ),
                newLines = Array( lines.length ),
                currImport;
            for( var i = 0; i < lines.length; i++ ) {
                if( currImport = Import.fromJs( lines[i], target ) ) {
                    newLines[i] = currImport.toJs();
                } else {
                    newLines[i] = lines[i];
                }
            }
            return api.postWithEditToken( {
                action: "edit",
                title: getFullTarget( target ),
                summary: STRINGS.normalizeSummary,
                text: newLines.join( "\n" )
            } );
        } );
    }

    function conditionalReload( openPanel ) {
        if( window.scriptInstallerAutoReload ) {
            if( openPanel ) document.cookie = "open_script_installer=yes";
            window.location.reload( true );
        }
    }

    /********************************************
     *
     * UI code
     *
     ********************************************/
    function makePanel() {
        var list = $( "<div>" ).attr( "id", "script-installer-panel" )
            .append( $( "<header>" ).text( STRINGS.panelHeader ) );
        var container = $( "<div>" ).addClass( "container" ).appendTo( list );
        
        // Container for checkboxes
        container.append( $( "<div>" )
            .attr( "class", "checkbox-container" )
            .append(
                $( "<input>" )
                    .attr( { "id": "siNormalize", "type": "checkbox" } )
                    .click( function () {
                        $( ".normalize-wrapper" ).toggle( 0 )
                    } ),
                $( "<label>" )
                    .attr( "for", "siNormalize" )
                    .text( STRINGS.showNormalizeLinks ),
                $( "<input>" )
                    .attr( { "id": "siMove", "type": "checkbox" } )
                    .click( function () {
                        $( ".move-wrapper" ).toggle( 0 )
                    } ),
                $( "<label>" )
                    .attr( "for", "siMove" )
                    .text( STRINGS.showMoveLinks ) ) );
        if( scriptCount > NUM_SCRIPTS_FOR_SEARCH ) {
            container.append( $( "<div>" )
                .attr( "class", "filter-container" )
                .append(
                    $( "<label>" )
                        .attr( "for", "siQuickFilter" )
                        .text( STRINGS.quickFilter ),
                    $( "<input>" )
                        .attr( { "id": "siQuickFilter", "type": "text" } )
                        .on( "input", function () {
                            var filterString = $( this ).val();
                            if( filterString ) {
                                var sel = "#script-installer-panel li[name*='" +
                                        $.escapeSelector( $( this ).val() ) + "']";
                                $( "#script-installer-panel li.script" ).toggle( false );
                                $( sel ).toggle( true );
                            } else {
                                $( "#script-installer-panel li.script" ).toggle( true );
                            }
                        } )
                ) );

            // Now, get the checkboxes out of the way
            container.find( ".checkbox-container" )
                .css( "float", "right" );
        }
        $.each( imports, function ( targetName, targetImports ) {
            var fmtTargetName = ( targetName === "common"
                ? "common (applies to all skins)"
                : targetName );
                if( targetImports.length ) {
                container.append(
                    $( "<h2>" ).append(
                        fmtTargetName,
                        $( "<span>" )
                        .addClass( "normalize-wrapper" )
                        .append( 
                            " (",
                            $( "<a>" )
                                .text( "normalize" )
                                .click( function () {
                                    normalize( targetName ).done( function () {
                                        conditionalReload( true );
                                    } );
                                 } ),
                            ")" )
                            .hide() ),
                        $( "<ul>" ).append(
                            targetImports.map( function ( anImport ) {
                                return $( "<li>" )
                                    .addClass( "script" )
                                    .attr( "name", anImport.getDescription() )
                                    .append(
                                        $( "<a>" )
                                            .text( anImport.getDescription() )
                                            .addClass( "script" )
                                            .attr( "href", anImport.getHumanUrl() ),
                                        " (",
                                        $( "<a>" )
                                            .text( STRINGS.uninstallLinkText )
                                            .click( function () {
                                                $( this ).text( STRINGS.uninstallProgressMsg );
                                                anImport.uninstall().done( function () {
                                                    conditionalReload( true );
                                                } );
                                            } ),
                                        " | ",
                                        $( "<a>" )
                                            .text( anImport.disabled ? STRINGS.enableLinkText : STRINGS.disableLinkText )
                                            .click( function () {
                                                $( this ).text( anImport.disabled ? STRINGS.enableProgressMsg : STRINGS.disableProgressMsg );
                                                anImport.toggleDisabled().done( function () {
                                                    $( this ).toggleClass( "disabled" );
                                                    conditionalReload( true );
                                                } );
                                            } ),
                                        $( "<span>" )
                                            .addClass( "move-wrapper" )
                                            .append(
                                            " | ",
                                            $( "<a>" )
                                                .text( STRINGS.moveLinkText )
                                                .click( function () {
                                                    var dest = null;
                                                    var PROMPT = STRINGS.movePrompt + " " + SKINS.join( ", " );
                                                    do {
                                                        dest = ( window.prompt( PROMPT ) || "" ).toLowerCase();
                                                    } while( dest && SKINS.indexOf( dest ) < 0 )
                                                    if( !dest ) return;
                                                    $( this ).text( STRINGS.moveProgressMsg );
                                                    anImport.move( dest ).done( function () {
                                                        conditionalReload( true );
                                                    } );
                                                } )
                                            )
                                            .hide(),
                                        ")" )
                                .toggleClass( "disabled", anImport.disabled );
                                } ) ) );
                }
        } );
        return list;
    }

    function buildCurrentPageInstallElement() {
        var addingInstallLink = false; // will we be adding a legitimate install link?
        var installElement = $( "<span>" ); // only used if addingInstallLink is set to true

        var namespaceNumber = mw.config.get( "wgNamespaceNumber" );
        var pageName = mw.config.get( "wgPageName" );

        // Namespace 2 is User
        if( namespaceNumber === 2 &&
                pageName.indexOf( "/" ) > 0 ) {
            var contentModel = mw.config.get( "wgPageContentModel" );
            if( contentModel === "javascript" ) {
                var prefixLength = mw.config.get( "wgUserName" ).length + 6;
                if( pageName.indexOf( USER_NAMESPACE_NAME + ":" + mw.config.get( "wgUserName" ) ) === 0 ) {
                    var skinIndex = SKINS.indexOf( pageName.substring( prefixLength ).slice( 0, -3 ) );
                    if( skinIndex >= 0 ) {
                        return $( "<abbr>" ).text( STRINGS.cannotInstall )
                                .attr( "title", STRINGS.cannotInstallSkin );
                    }
                }
                addingInstallLink = true;
            } else {
                return $( "<abbr>" ).text( STRINGS.cannotInstall + " (" + STRINGS.notJavaScript + ")" )
                        .attr( "title", STRINGS.cannotInstallContentModel.replace( "$1", contentModel ) );
            }
        }

        // Namespace 8 is MediaWiki
        if( namespaceNumber === 8 ) {
            return $( "<a>" ).text( STRINGS.installViaPreferences )
                    .attr( "href", mw.util.getUrl( "Special:Preferences" ) + "#mw-prefsection-gadgets" );
        }

        var editRestriction = mw.config.get( "wgRestrictionEdit" );
        if( ( namespaceNumber !== 2 && namespaceNumber !== 8 ) &&
            ( editRestriction.indexOf( "sysop" ) >= 0 ||
                editRestriction.indexOf( "editprotected" ) >= 0 ) ) {
            installElement.append( " ",
                $( "<abbr>" ).append(
                    $( "<img>" ).attr( "src", "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Achtung-yellow.svg/20px-Achtung-yellow.svg.png" ).addClass( "warning" ),
                    STRINGS.insecure )
                .attr( "title", STRINGS.tempWarning ) );
            addingInstallLink = true;
        }

        if( addingInstallLink ) {
            var fixedPageName = mw.config.get( "wgPageName" ).replace( /_/g, " " );
            installElement.prepend( $( "<a>" )
                    .attr( "id", "script-installer-main-install" )
                    .text( localScriptsByName[ fixedPageName ] ? STRINGS.uninstallLinkText : STRINGS.installLinkText )
                    .click( makeLocalInstallClickHandler( fixedPageName ) ) );

            // If the script is installed but disabled, allow the user to enable it
            var allScriptsInTarget = imports[ localScriptsByName[ fixedPageName ] ];
            var importObj = allScriptsInTarget && allScriptsInTarget.find( function ( anImport ) { return anImport.page === fixedPageName; } );
            if( importObj && importObj.disabled ) {
                installElement.append( " | ",
                    $( "<a>" )
                        .attr( "id", "script-installer-main-enable" )
                        .text( STRINGS.enableLinkText )
                        .click( function () {
                            $( this ).text( STRINGS.enableProgressMsg );
                            importObj.setDisabled( false ).done( function () {
                                conditionalReload( false );
                            } );
                        } ) );
            }
            return installElement;
        }

        return $( "<abbr>" ).text( STRINGS.cannotInstall + " " + STRINGS.insecure )
                .attr( "title", STRINGS.badPageError );
    }

    function showUi() {
        var fixedPageName = mw.config.get( "wgPageName" ).replace( /_/g, " " );
        $( "#firstHeading" ).append( $( "<span>" )
            .attr( "id", "script-installer-top-container" )
            .append(
                buildCurrentPageInstallElement(),
                " | ",
                $( "<a>" )
                    .text( STRINGS.manageUserScripts ).click( function () {
                        if( !document.getElementById( "script-installer-panel" ) ) {
                            $( "#mw-content-text" ).before( makePanel() );
                        } else {
                            $( "#script-installer-panel" ).remove();
                        }
                     } ) ) );
    }

    function attachInstallLinks() {
        // At the end of each {{Userscript}} transclusion, there is
        // <span id='User:Foo/Bar.js' class='scriptInstallerLink'></span>
        $( "span.scriptInstallerLink" ).each( function () {
            var scriptName = this.id;
            $( this ).append( " | ", $( "<a>" )
                    .text( localScriptsByName[ scriptName ] ? STRINGS.uninstallLinkText : STRINGS.installLinkText )
                    .click( makeLocalInstallClickHandler( scriptName ) ) );
        } );

        $( "table.infobox-user-script" ).each( function () {
            var scriptName = $( this ).find( "th:contains('Source')" ).next().text() ||
                    mw.config.get( "wgPageName" );
            scriptName = /user:.+?\/.+?.js/i.exec( scriptName )[0];
            $( this ).children( "tbody" ).append( $( "<tr>" ).append( $( "<td>" )
                    .attr( "colspan", "2" )
                    .addClass( "script-installer-ibx" )
                    .append( $( "<button>" )
                        .addClass( "mw-ui-button mw-ui-progressive mw-ui-big" )
                        .text( localScriptsByName[ scriptName ] ? STRINGS.uninstallLinkText : STRINGS.installLinkText )
                        .click( makeLocalInstallClickHandler( scriptName ) ) ) ) );
        } );
    }

    function makeLocalInstallClickHandler( scriptName ) {
        return function () {
            var $this = $( this );
            if( $this.text() === STRINGS.installLinkText ) {
                var okay = window.sciNoConfirm || window.confirm( STRINGS.bigSecurityWarning );
                if( okay ) {
                    $( this ).text( STRINGS.installProgressMsg )
                    Import.ofLocal( scriptName, window.scriptInstallerInstallTarget ).install().done( function () {
                        $( this ).text( STRINGS.uninstallLinkText );
                        conditionalReload( false );
                    }.bind( this ) );
                }
            } else {
                $( this ).text( STRINGS.uninstallProgressMsg )
                var uninstalls = uniques( localScriptsByName[ scriptName ] )
                        .map( function ( target ) { return Import.ofLocal( scriptName, target ).uninstall(); } )
                $.when.apply( $, uninstalls ).then( function () {
                    $( this ).text( STRINGS.installLinkText );
                    conditionalReload( false );
                }.bind( this ) );
            }
         };
    }

    function addCss() {
        mw.util.addCSS(
            "#script-installer-panel li.disabled a.script { "+
              "text-decoration: line-through; font-style: italic; }"+
            "#script-installer-panel { width:60%; border:solid lightgray 1px; "+
              "padding:0; margin-left: auto; "+
              "margin-right: auto; margin-bottom: 15px; overflow: auto; "+
              "box-shadow: 5px 5px 5px #999; background-color: #fff; z-index:50; }"+
            "#script-installer-panel header { background-color:#CAE1FF; display:block;"+
              "padding:5px; font-size:1.1em; font-weight:bold; text-align:left; }"+
            "#script-installer-panel .checkbox-container input { margin-left: 1.5em; }"+
            "#script-installer-panel .filter-container { margin-bottom: -0.75em; }"+
            "#script-installer-panel .filter-container label { margin-right: 0.35em; }"+
            "#script-installer-panel .container { padding: 0.75em; }"+
            "#script-installer-panel .container h2 { margin-top: 0.75em; }"+
            "#script-installer-panel a { cursor: pointer; }"+
            "#script-installer-main-install { font-weight: bold; }"+
            "#script-installer-top-container { bottom: 5px; font-size: 70%; margin-left: 1em }"+
            "body.skin-modern #script-installer-top-container a { color: inherit; cursor: pointer }"+
            "body.skin-timeless #script-installer-top-container a,body.skin-cologneblue #script-installer-top-container a { cursor: pointer }"+
            "#script-installer-top-container img.warning { position: relative; top: -2px; margin-right: 3px }"+
            "td.script-installer-ibx { text-align: center }"
        );
    }

    /********************************************
     *
     * Utility functions
     *
     ********************************************/

    /**
     * Gets the wikitext of a page with the given title (namespace required).
     */
    function getWikitext( title ) {
        return $.getJSON(
            mw.util.wikiScript( "api" ),
            {
                format: "json",
                action: "query",
                prop: "revisions",
                rvprop: "content",
                rvslots: "main",
                rvlimit: 1,
                titles: title
            }
        ).then( function ( data ) {
            var pageId = Object.keys( data.query.pages )[0];
            if( data.query.pages[pageId].revisions ) {
                return data.query.pages[pageId].revisions[0].slots.main["*"];
            }
            return "";
        } );
    }

    function escapeForRegex( s ) {
        return s.replace( /[-\/\\^$*+?.()|[\]{}]/g, '\\$&' );
    }

    function getFullTarget ( target ) {
        return USER_NAMESPACE_NAME + ":" + mw.config.get( "wgUserName" ) + "/" + 
                target + ".js";
    }

    // From https://stackoverflow.com/a/10192255
    function uniques( array ){
        return array.filter( function( el, index, arr ) {
            return index === arr.indexOf( el );
        });
    }

    if( window.scriptInstallerAutoReload === undefined ) {
        window.scriptInstallerAutoReload = true;
    }

    if( window.scriptInstallerInstallTarget === undefined ) {
        window.scriptInstallerInstallTarget = "common"; // by default, install things to the user's common.js
    }

    var jsPage = mw.config.get( "wgPageName" ).slice( -3 ) === ".js" ||
        mw.config.get( "wgPageContentModel" ) === "javascript";
    $.when(
        $.ready,
        mw.loader.using( [ "mediawiki.api", "mediawiki.util" ] )
    ).then( function () {
        api = new mw.Api();
        addCss();
        buildImportList().then( function () {
            attachInstallLinks();
            if( jsPage ) showUi();

            // Auto-open the panel if we set the cookie to do so (see `conditionalReload()`)
            if( document.cookie.indexOf( "open_script_installer=yes" ) >= 0 ) {
                document.cookie = "open_script_installer=; expires=Thu, 01 Jan 1970 00:00:01 GMT";
                $( "#script-installer-top-container a:contains('Manage')" ).trigger( "click" );
            }
        } );
    } );
} )();
