
var UploadProgressAddon = function() {
	this.init();
}

UploadProgressAddon.prototype = {
	uploadManager: null,
	uploadManagerWindow: null,	// singleton window
	showUploadManager: function() {
		if (!this.uploadManagerWindow || this.uploadManagerWindow.closed) {
			// if the window does not exist or was already closed, re-open it
			this.uploadManagerWindow = openDialog('chrome://uploadprogress/content/uploads.xul', 'uploadManagerWindow');
		} else {
			// already opened, bring it to front
			this.uploadManagerWindow.focus();
		}
	},
	registerUploadManagerWindow: function(win) {
		this.uploadManager.load(win.document);
	},
	unregisterUploadManagerWindow: function(win) {
		this.uploadManager.unload(win.document);
	},
	init: function() {
		// Following line was giving a warning in the AMO validator, but it is actually
		// safe to do this since the object is defined by the add-on itself
		this.uploadManager = Components.classes["@alfersoft.com.ar/uploads-service;1"].getService().wrappedJSObject;
	}
}

let uploadProgressAddon = new UploadProgressAddon();
document.addEventListener("load", function() { uploadProgressAddon.uploadManager.setMainDocument(document, uploadProgressAddon); }, false);
