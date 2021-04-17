/**
 * script-installer loader
 */

if( mw.config.get( "wgNamespaceNumber" ) > 0 ) {
    var jsPage = mw.config.get( "wgPageName" ).slice( -3 ) === ".js" ||
        mw.config.get( "wgPageContentModel" ) === "javascript";
    if( jsPage || document.getElementsByClassName( "scriptInstallerLink" ).length ||
            document.querySelector( "table.infobox-user-script" ) ) {
        mw.loader.load('/w/index.php?title=User:JJPMaster/install.js/code.js&action=raw&ctype=text/javascript');
    }
}
