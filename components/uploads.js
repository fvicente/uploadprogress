////////////////////////////////////////////////////////////////////////////////
//// Globals

Components.utils.import("resource://gre/modules/DownloadUtils.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/PluralForm.jsm");

function UploadProgressComponent() {
	// Following line is giving a warning in the AMO validator, just ignore it
	this.wrappedJSObject = this;
	this.init();
}

// Component implementation
UploadProgressComponent.prototype = {
	classID: Components.ID("{64DBCAD2-AAF0-11DF-AF22-013ADFD72085}"),
	classDescription: "Uploads Progress Window",
	contractID: "@alfersoft.com.ar/uploads-service;1",
 	QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIObserver]),
	// Custom properties and methods
	idCount: 0,
	documents: [],
	activeUploads: {},
	activeUploadsCount: 0,
	observer: null,
	mainDocument: null,
	addon: null,
	// shortcuts
	cc: Components.classes["@mozilla.org/network/http-activity-distributor;1"],
	ci: Components.interfaces,
	// preferences
	prefs: null,
	minUploadSize: 100000,		// uploads bigger than this will appear in our progress bar of the status bar
	hideProgressStatusBar: false,
	autoPopup: false,
	////////////////////////////////////////////////////////////////////////////
	//// Startup, Shutdown
	init: function() {
		//dump(">>>>>>>>>>>>>>>>>>>>>> INITIALIZED\n");
		// add observer
		var hao = Components.interfaces.nsIHttpActivityObserver;
		var _self = this;
		// Register to receive notifications of preference changes
		this.prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("uploadprogress.");
		this.prefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
		this.prefs.addObserver("", this, false);
		this.minUploadSize = this.prefs.getIntPref("minUploadSize");
		this.autoPopup = this.prefs.getBoolPref("autoPopup");
		this.hideProgressStatusBar = this.prefs.getBoolPref("hideProgressStatusBar");
		this.observer = {
			observeActivity: function(aHttpChannel, aActivityType, aActivitySubtype, aTimestamp, aExtraSizeData, aExtraStringData) {
				if ((aActivityType == hao.ACTIVITY_TYPE_SOCKET_TRANSPORT) && (aActivitySubtype == 0x804b0005)) { // STATUS_SENDING_TO
					//dump("UPDATE STATUS: ["+aTimestamp+"] *" + aHttpChannel + "*\n");
					_self.updateStatus(aHttpChannel, aTimestamp, aExtraSizeData);
				}
				if (aActivityType == hao.ACTIVITY_TYPE_HTTP_TRANSACTION) {
					switch(aActivitySubtype) {
						//case hao.ACTIVITY_SUBTYPE_RESPONSE_COMPLETE:
						case hao.ACTIVITY_SUBTYPE_TRANSACTION_CLOSE:
							//dump("REMOVE: *" + aHttpChannel + "*\n");
							_self.removeUpload(aHttpChannel);
							break;
						case hao.ACTIVITY_SUBTYPE_REQUEST_HEADER:
							//dump("CREATE: *" + aHttpChannel + "*\n");
							_self.createUpload(aHttpChannel);
							break;
					}
				}
			}
		};
		this.cc.getService(Components.interfaces.nsIHttpActivityDistributor).addObserver(this.observer);
	},
	shutdown: function() {
		this.prefs.removeObserver("", this);
		this.cc.getService(Components.interfaces.nsIHttpActivityDistributor).removeObserver(this.observer);
	},
	////////////////////////////////////////////////////////////////////////////
	//// Load, Unload
	loadStrings: function(doc) {
		// These strings will be converted to the corresponding ones from the
		// string bundle
		let gStr = {
			doneStatus: "doneStatus",
			doneSize: "doneSize",
			doneSizeUnknown: "doneSizeUnknown",
			stateFailed: "stateFailed",
			stateCanceled: "stateCanceled",
			yesterday: "yesterday",
			monthDate: "monthDate"
		};
		// convert strings to those in the string bundle
		let (sb = doc.getElementById("uploadStrings")) {
			let getStr = function(string) sb.getString(string);
			for (let [name, value] in Iterator(gStr))
				gStr[name] = typeof value == "string" ? getStr(value) : value.map(getStr);
		}
	},
	load: function(doc) {
		this.loadStrings(doc);
		// build list
		var idx;
		for (idx in this.activeUploads) {
			this.createItem(doc, this.activeUploads[idx]);
		}
		this.documents.push(doc);
	},
	unload: function(doc) {
		this.documents.splice(this.documents.indexOf(doc), 1);
	},
	setMainDocument: function(doc, addon) {
		this.mainDocument = doc;
		this.addon = addon;
		this.loadStrings(doc);
	},
	////////////////////////////////////////////////////////////////////////////
	//// Preferences
	observe: function(subject, topic, data) {
		if (topic != "nsPref:changed") {
			return;
		}
		switch(data) {
		case "minUploadSize":
			this.minUploadSize = this.prefs.getIntPref("minUploadSize");
			break;
		case "autoPopup":
			this.autoPopup = this.prefs.getBoolPref("autoPopup");
			break;
		case "hideProgressStatusBar":
			this.hideProgressStatusBar = this.prefs.getBoolPref("hideProgressStatusBar");
			if (this.activeUploadsCount && !this.hideProgressStatusBar) {
				var holder = this.mainDocument.getElementById("upload-pb-holder");
				if (holder) holder.setAttribute("hidden", "false");
			}
			break;
		}
	},
	////////////////////////////////////////////////////////////////////////////
	//// Helper functions
	createUpload: function(aHttpChannel) {
		var uc = aHttpChannel.QueryInterface(this.ci.nsIUploadChannel);
		if (!uc || !uc.uploadStream) {
			// we are interested in uploads only
			return;
		}
		var propw = aHttpChannel.QueryInterface(this.ci.nsIWritablePropertyBag2);
		if (!propw || !propw.setPropertyAsUint32) {
			// must be able to write a property on the object, otherwise is not
			// possible to track it correctly
			return;
		}
		++this.idCount;
		propw.setPropertyAsUint32("ulid", this.idCount);
		// get the size of the upload, this will include HTTP headers
		var maxBytes = uc.uploadStream.available();
		if (maxBytes <= 0) {
			return;
		}
		if (this.mainDocument && maxBytes > this.minUploadSize) {
			if (!this.activeUploadsCount) {
				this.mainDocument.getElementById("upload-pb").setAttribute("value", "0");
				this.mainDocument.getElementById("upload-pb-label").setAttribute("value", "");
				// addon bar (FireFox 4)
				var pb = this.mainDocument.getElementById("upload-pb-aob");
				if (pb) {
					pb.setAttribute("value", "0");
					this.mainDocument.getElementById("upload-pb-label-aob").setAttribute("value", "");
				}
			}
			if (!this.hideProgressStatusBar) {
				var holder = this.mainDocument.getElementById("upload-pb-holder");
				if (holder) holder.setAttribute("hidden", "false");
			}
			// addon bar (FireFox 4)
			var holder = this.mainDocument.getElementById("upload-pb-holder-aob");
			if (holder) holder.setAttribute("hidden", "false");
			if (this.autoPopup) {
				this.addon.showUploadManager();
			}
		}
		// get destination url
		var url = "";
		var channel = aHttpChannel.QueryInterface(this.ci.nsIHttpChannel);
		if (channel && channel.referrer) {
			url = channel.referrer.spec;
		}
		var id = this.getId(aHttpChannel);
		this.activeUploads[id] = {
			"id": id,
			"url": url,
			"currBytes": 0,
			"maxBytes": maxBytes,
			"lastPercent": 0,
			"lastSeconds": Infinity,
			"lastCurrBytes": 0,
			"speed": 0,
			"updatedETA": true,
			"lastTimestamp": 0
		};
		this.activeUploadsCount++;
		var idx;
		for (idx in this.documents) {
			this.createItem(this.documents[idx], this.activeUploads[id]);
		}
	},
	createItem: function(doc, upload) {
		var view = doc.getElementById("uploadView");
		var ul = doc.createElement("richlistitem");
		// initialize attributes
		ul.setAttribute("type", "upload");
		ul.setAttribute("id", "ul" + upload.id);
		ul.setAttribute("image", "chrome://uploadprogress/skin/uploadIcon.png");
		ul.setAttribute("lastSeconds", upload.lastSeconds);
		ul.setAttribute("target", upload.url);
		ul.setAttribute("uri", upload.url);
		ul.setAttribute("state", 0);
		ul.setAttribute("progressmode", "normal");
		ul.setAttribute("lastPercent", upload.lastPercent);
		ul.setAttribute("currBytes", upload.currBytes);
		ul.setAttribute("maxBytes", upload.maxBytes);
		ul.setAttribute("progressString", "0%");
		view.appendChild(ul);
		return ul;
	},
	removeUpload: function(aHttpChannel) {
		var id = this.getId(aHttpChannel);
		var upload = this.activeUploads[id];
		if (!upload) {
			return;
		}
		var idx, doc;
		for (idx in this.documents) {
			doc = this.documents[idx];
			var ul = doc.getElementById("ul" + upload.id);
			if (ul) {
				doc.getElementById("uploadView").removeChild(ul);
			}
		}
		delete this.activeUploads[id];
		this.activeUploadsCount--;
		if (!this.activeUploadsCount && this.mainDocument) {
			var holder = this.mainDocument.getElementById("upload-pb-holder");
			if (holder) holder.setAttribute("hidden", "true");
			// addon bar (FireFox 4)
			var holder = this.mainDocument.getElementById("upload-pb-holder-aob");
			if (holder) holder.setAttribute("hidden", "true");
		}
	},
	updateStatus: function(aHttpChannel, aTimestamp, currBytes) {
		var id = this.getId(aHttpChannel);
		var upload = this.activeUploads[id];
		if (!upload) {
			return;
		}
		var lastPercent = upload.lastPercent;
		var maxBytes = upload.maxBytes;
		var percent = parseInt((currBytes * 100) / maxBytes);
		if (currBytes > maxBytes) {
			currBytes = maxBytes;
			percent = 100;
		}
		var calcTotalPercent = false;
		var elapsed = (aTimestamp - upload.lastTimestamp) / 1000; // ms
		if (upload.lastTimestamp && (elapsed > 1000)) {
			upload.speed = (currBytes - upload.lastCurrBytes) / (elapsed / 1000); // bytes per sec
			//dump("**** ["+elapsed+"] CALCULATED SPEED: " + upload.speed + " cur:["+currBytes+"] last:["+upload.lastCurrBytes+"]\n");
			upload.lastCurrBytes = currBytes;
			upload.updatedETA = true;
			upload.lastTimestamp = aTimestamp;
		}
		if (!upload.lastTimestamp) {
			upload.lastTimestamp = aTimestamp;
		}
		if (percent != lastPercent || upload.updatedETA) {
			var calcTotalPercent = true;
			var status = "";
			var newLast;
			[status, newLast] = DownloadUtils.getDownloadStatus(currBytes, maxBytes, upload.speed, upload.lastSeconds);
			var idx;
			for (idx in this.documents) {
				var ul = this.documents[idx].getElementById("ul" + upload.id);
				if (ul) {
					ul.setAttribute("currBytes", currBytes);
					ul.setAttribute("progress", percent);
					ul.setAttribute("progressString", percent + "%");
					ul.setAttribute("status", status);
					ul.setAttribute("lastSeconds", newLast);
				}
			}
			upload.lastPercent = percent;
			upload.lastSeconds = newLast;
			upload.updatedETA = false;
		}
		//dump(">>>> ["+new Date()+"] SETTING currBytes TO : " + currBytes + "\n");
		upload.currBytes = currBytes;
		if (calcTotalPercent && this.mainDocument) {
			// just counting uploads with size > this.minUploadSize
			var activeUploadsCount = 0;
			var totBytes = 0;
			var sentBytes = 0;
			for (idx in this.activeUploads) {
				upload = this.activeUploads[idx];
				if (upload.maxBytes > this.minUploadSize) {
					activeUploadsCount++;
					sentBytes += upload.currBytes;
					totBytes += upload.maxBytes;
				}
			}
			if (activeUploadsCount && totBytes && totBytes >= sentBytes) {
				var totPerc = parseInt((sentBytes * 100) / totBytes);
				var tooltip = PluralForm.get(activeUploadsCount, this.mainDocument.getElementById("uploadStrings").getString("uploadsTitlePercent"));
				tooltip = tooltip.replace("#" + 1, activeUploadsCount);
				tooltip = tooltip.replace("#" + 2, totPerc);
				var pb = this.mainDocument.getElementById("upload-pb");
				pb.setAttribute("tooltiptext", tooltip);
				pb.setAttribute("value", totPerc);
				this.mainDocument.getElementById("upload-pb-label").setAttribute("value", tooltip);
				// addon bar (FireFox 4)
				var pb = this.mainDocument.getElementById("upload-pb-aob");
				if (pb) {
					pb.setAttribute("tooltiptext", tooltip);
					pb.setAttribute("value", totPerc);
					this.mainDocument.getElementById("upload-pb-label-aob").setAttribute("value", tooltip);
				}
			}
		}
	},
	getId: function(obj) {
		return obj.QueryInterface(this.ci.nsIPropertyBag2).get("ulid");
	}
}

if (XPCOMUtils.generateNSGetFactory)
	var NSGetFactory = XPCOMUtils.generateNSGetFactory([UploadProgressComponent]);
else
	var NSGetModule = XPCOMUtils.generateNSGetModule([UploadProgressComponent]);
