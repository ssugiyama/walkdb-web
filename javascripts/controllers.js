(function (global) {
    'use strict';

    var module = angular.module('walkApp', []);
    module.factory('walkService', function () {
        var service = function () {
            var self = this;

            this.initMap = function (scope, elm) {
                var defaultPos = new google.maps.LatLng(35.690,139.70);
                var options = {
                    zoom: 13,
                    center: defaultPos,
                    mapTypeId: google.maps.MapTypeId.ROADMAP,
                    disableDoubleClickZoom: true,
                    scaleControl: true,
                    scrollwheel : false,
                    streetViewControl: true
                };

                self.map = new google.maps.Map(elm, options);
                self.distanceWidget = new google.maps.Circle({
                    strokeWeight: 2,
                    editable: true,
                    color: '#000',
                    center: defaultPos,
                    radius: 500,
                });

                google.maps.event.addListener(self.map, 'click', function (event) {
                    if(scope.searchForm.filter == 'neighborhood'){
                        self.distanceWidget.setCenter(event.latLng);
                    }
                    else if(scope.searchForm.filter == 'cities') {
                        $.ajax({
                            url: '/add_city',
                            data: "latitude=" + event.latLng.lat() + "&longitude=" + event.latLng.lng(),
                            success : function (data) {
                                self.addCity(data.jcode, data.the_geom);
                            },
                        });
                    }
                });
                google.maps.event.addListener(this.map, 'center_changed', function () {
                    self.storeCenterAndZoom();
                });

                google.maps.event.addListener(this.map, 'zoom_changed', function () {
                    self.storeCenterAndZoom();
                });

                self.cities = {};
                self.pathManager = new PathManager({map: self.map});
                google.maps.event.addListener(self.pathManager, 'editable_changed', function () {
                    scope.editable = self.pathManager.get('editable');
                    setTimeout(function () {scope.$digest();}, 0);
                });
                google.maps.event.addListener(self.pathManager, 'length_changed', function () {
                    scope.selectionLength = self.pathManager.get('length');
                    setTimeout(function () {scope.$digest();}, 0);
                });
                google.maps.event.addListener(self.pathManager, 'selection_changed', function () {
                    self.panoramaPointsAndHeadings = self.getPanoramaPointsAndHeadings();
                    if (self.pathManager.selection){
                        if(scope.currentService == 'elevation') {
                            self.requestElevation();
                        }
                        else if (scope.currentService == 'panorama'){
                            self.panoramaIndex = 0;
                            self.showPanorama();
                            scope.panoramaIndex = self.panoramaIndex+1;
                            scope.panoramaCount = self.panoramaCount;
                        }
                    }
                    else {
                        scope.currentService = 'none';
                    }
                    setTimeout(function () {scope.$digest();}, 0);
                });

                self.elevator = new google.maps.ElevationService();
                self.infoWindow = new google.maps.InfoWindow();
		self.geocoder = new google.maps.Geocoder();
                self.streetViewService = new google.maps.StreetViewService();
                self.panoramaIndex = 0;
                self.panoramaInterval = 50;

                self.loadCenterAndZoom();
            };
            this.importFile = function (file) {
                var reader = new FileReader();
                reader.addEventListener('loadend', function(e) {
                    var obj = JSON.parse(e.target.result);
                    var coordinates = obj.coordinates;
                    var pts = coordinates.map(function (item) {
                        return new google.maps.LatLng(item[1], item[0]);
                    });
                    var path = new google.maps.MVCArray(pts);
                    self.pathManager.showPath(path, true);
                });
                reader.readAsText(file);
            };
            this.importJSON = function (json) {
                var obj = JSON.parse(json);
                var coordinates = obj.coordinates;
                var pts = coordinates.map(function (item) {
                    return new google.maps.LatLng(item[1], item[0]);
                });
                var path = new google.maps.MVCArray(pts);
                self.pathManager.showPath(path, true);
            };
            this.requestElevation = function (){
                var path = [];
                if (!this.pathManager.selection) return;
                this.pathManager.selection.getPath().forEach(function (elem,i){
                    path.push(elem);
                });

                var pathRequest = {
                    'path': path,
                    'samples': 256
                }
                var self = this;
                // Initiate the path request.
                if (this.elevator) {
                    this.elevator.getElevationAlongPath(pathRequest, function (results, status) {
                        self.plotElevation(results, status);
                    });
                }
            };

            this.plotElevation = function (results, status) {
                if (status == google.maps.ElevationStatus.OK) {
                    this.elevations = results;
                    var data = [];
                    for (var i = 0; i < results.length; i++) {
                        data.push([i, this.elevations[i].elevation]);
                    }
                    // Draw the chart using the data within its DIV.
                    //		    $(this.elevationBox).dialog('open');

                    $.plot($(this.elevation), [data], {
                        xaxis : {show: false},
                        colors : ['#ff0000'],
                        grid : {
                            hoverable : true,
                            backgroundColor: 'white'
                        },
                    });

                }
            };

            this.showDistanceWidget = function (show) {
                if (show) {
                    this.distanceWidget.setMap(this.map);
                }
                else{
                    this.distanceWidget.setMap(null);
                }
            };

            this.showCities = function (show) {
                for (var id in this.cities) {
                    var pg = self.cities[id];
                    pg.setMap(show?self.map:null);
                }
            };
            this.storeCenterAndZoom = function () {
                if (localStorage) {
                    var center = this.map.getCenter();
                    var array = [center.lat(), center.lng(), this.map.getZoom()];
                    localStorage['centerAndZoom'] = JSON.stringify(array);
                }
            };

            this.loadCenterAndZoom =  function () {
                if (localStorage && localStorage['centerAndZoom']) {
                    var array = JSON.parse(localStorage["centerAndZoom"]);
                    var center = new google.maps.LatLng(array[0], array[1]);
                    this.map.setCenter(center);
                    this.map.setZoom(array[2]);
                }
            };
            this.addCity = function (id, str) {
                if (this.cities[id]) return;
                //        var pg = Walkrr.wkt2GMap(str);
                var paths = str.split(" ").map(function (element, index, array){
                    return google.maps.geometry.encoding.decodePath(element);
                });
                var pg =  new google.maps.Polygon({});
                pg.setPaths(paths);
                pg.setOptions(this.areaStyle);
                pg.setMap(this.map);
                this.cities[id] = pg;
                var self = this;
                google.maps.event.addListener(pg, 'click',  function () {
                    pg.setMap(null);
                    pg = null;
                    delete self.cities[id];
                });
            };

            this.showPanorama = function () {
                if (!this.pathManager.selection) return;

                this.panoramaCount = this.panoramaPointsAndHeadings.length;

                if (this.panoramaIndex < 0) this.panoramaIndex = 0;
                else if(this.panoramaIndex >=  this.panoramaCount) this.panoramaIndex = this.panoramaCount -1;

                var item = this.panoramaPointsAndHeadings[this.panoramaIndex];
                var pt = item[0];
                var heading = item[1];
                var self = this;
                this.streetViewService.getPanoramaByLocation(pt, 50, function (data, status){
                    if (status == google.maps.StreetViewStatus.OK) {
                        self.panorama.setPano(data.location.pano);
                        self.panorama.setPov({heading: heading, zoom: 1, pitch: 0});
                        self.panorama.setVisible(true);
                    }
                    else {
                        self.panorama.setVisible(false);
                    }
                });

                this.map.setCenter(pt);

            };

            this.interpolatePoints = function(pt1, pt2, r) {
                return new google.maps.LatLng(r*pt2.lat() + (1-r)*pt1.lat(), r*pt2.lng() + (1-r)*pt1.lng());
            };
            this.getPanoramaPointsAndHeadings = function () {
                if (!this.pathManager.selection) return null;
                var pph = [];
                var path = this.pathManager.selection.getPath();
                var count = path.getLength();
                var way = 0;
                var dsum = 0;
                for (var i= 0; i < count-1; i++) {
                    var pt1 = path.getAt(i);
                    var pt2 = path.getAt(i+1);
                    var d = google.maps.geometry.spherical.computeDistanceBetween(pt1, pt2);
                    var h = google.maps.geometry.spherical.computeHeading(pt1, pt2);

                    while(way < dsum+d ) {
                        var pt = this.interpolatePoints(pt1, pt2, (way - dsum)/d);
                        pph.push([pt, h]);
                        way += this.panoramaInterval;
                    }
                    dsum += d;
                }
                pph.push([pt2, h]);
                return pph;

            };
            this.geocoderSearch = function(address) {
                var self = this;
                this.geocoder.geocode( { 'address': address}, function(results, status) {
		    if (status == google.maps.GeocoderStatus.OK) {
			self.map.setCenter(results[0].geometry.location);
		    } else {
			alert("Geocode was not successful for the following reason: " + status);
		    }
		});
            };
        };

        return new service();
    });

    module.directive('myMap', function (walkService){
        return function (scope, elm, attrs) {
	    walkService.initMap(scope, angular.element(elm)[0]);
        };
    });

    module.directive('myPanorama', function (walkService){
        return function (scope, elm, attrs) {
            walkService.panorama = new google.maps.StreetViewPanorama(angular.element(elm)[0],
            {
                addressControl: true,
                navigationControl: true,
                enableCloseButton: true,
            });
            google.maps.event.addListener(walkService.panorama, 'closeclick',  function (ev) {
                scope.currentService = 'none';
                setTimeout(function () {scope.$digest();}, 0);
            });
            walkService.map.setStreetView(walkService.panorama);

        };
    });


    module.directive('myElevation', function (walkService){
        return function (scope, elm, attrs) {
            walkService.elevation = elm;
            $(elm).on("plothover", function (event, pos, item) {
                var elevation = walkService.elevations[~~pos.x];
                if (!elevation) return;

                walkService.infoWindow.open(walkService.map);
                walkService.infoWindow.setPosition(elevation.location);
                var y = Math.round(elevation.elevation);
                walkService.infoWindow.setContent(y + 'm');
//                walkService.map.setCenter(elevation.location);
            });
            $(elm).on("mouseout", function () {
                walkService.infoWindow.close();
            });
        };
    });
    module.directive('myModal', function (walkService){
        return function (scope, elm, attrs) {
            walkService.modal = elm;
            var textarea = $(elm).find('textarea');
            textarea.on('click', function () {
                this.select();
            });
            var reader = new FileReader();
            reader.addEventListener('loadend', function(e) {
                scope.path_json = e.target.result;
                setTimeout(function () {scope.$digest();}, 0);
            });

            textarea.bind("drop", function (e) {
                e.stopPropagation();
                e.preventDefault();
                var files = e.originalEvent.dataTransfer.files;
                reader.readAsText(files[0]);
            }).bind("dragenter", function (e) {
                e.stopPropagation();
                e.preventDefault();
            }).bind("dragover", function (e) {
                e.stopPropagation();
                e.preventDefault();
            });

        };
    });
    module.directive('myAdmin', function (walkService){
        return function (scope, elm, attrs) {
            walkService.admin = elm;
        };
    });
    module.directive('myInfo', function (walkService){
        return function (scope, elm, attrs) {
            var input = $(elm).find('textarea,input');
            input.on('click', function () {
                this.select();
            });
            walkService.info = elm;
        };
    });
    module.controller("WalkController",  function ($scope, $http, $filter, walkService) {
        var self = this;
        //	$scope.selectionLength = 0;
	if ($('html').data('mobile')){
	    $scope.isMobile = true;
	    $(function (){ 
		resizeMap();
	    });
	    var resizeMap = function () {
		$('#main-box').height($(window).height() - $("[data-role='header']").height());
		google.maps.event.trigger(walkService.map, 'resize');
	    };
	    $("#page-maps").on('pageshow', resizeMap);
	    $(window).on('orientationchange', resizeMap);
	    $('.menu').on('click', function () {
		$(this).popup('close');
	    });
	}
	$(function () {
	    if (location.search) {
		$http.get('/search' + location.search).success(function (data) {
                    searchCallback(data, true);
		});
            } else if ($scope.isMobile) {
		$("#panel-search").panel("open");	    
	    }
	});

        function searchCallback (data, show, append) {
            if (append) {
                $scope.walks.push.apply($scope.walks, data.rows);
            }
            else {
                $scope.result = {};
                $scope.walks = data.rows;
            }
            $scope.params = data.params;
            $scope.total_count = data.count;

            data.rows.forEach(function (item, index, array) {
                $scope.result[item.id] = item;
            });
            if (show) {
                $scope.showPath(data.rows[0].id);
            }
	    if ($scope.isMobile && data.rows.length > 0){
		$("#panel-search form").collapsible("collapse");
	    }
        }
        $http.get('/version').success(function(data) {
            Object.keys(data).forEach(function (key) {
                $scope[key] = data[key];
            });
        });

        $http.get('http://api.bootswatch.com/3/').success(function (data) {
	    var themeInfo = {
		Default : {
		    uri:   null,
		    title: 'bootstrap default theme'
		}
	    };
            data.themes.forEach(function (item) {
                themeInfo[item.name] = {
		    uri: item.cssCdn,
		    title: item.description
		};
            });
            self.themeInfo = themeInfo;
            $scope.themes = Object.keys(themeInfo);
            $scope.setTheme(localStorage['currentTheme'] || 'Default');
        });
        $scope.month = '';
        $scope.year = '';
        $scope.years = [];
        var currentYear = (new Date()).getFullYear();
        for (var y = currentYear; y >= 1997; y--) {
            $scope.years.push(y);
        }
        $scope.currentService = 'none';
        $scope.searchForm = {};
        $scope.searchForm.filter = 'any';
        $scope.searchForm.order = "newest_first";
        $scope.searchForm.limit = 20;

        // dirty hack
        setTimeout(function () {
            google.maps.event.trigger(walkService.map, 'resize');
        }, 1000);
        $scope.setTheme = function (name) {
	    if ($scope.themes.indexOf(name) == -1) name = 'Default';
            $scope.themeUri = self.themeInfo[name].uri;
            localStorage['currentTheme'] = name;
        };
        $scope.getThemeTitle = function (name) {
            return self.themeInfo[name].title;
        };
        $scope.search = function () {
            if ($scope.searchForm.filter == 'neighborhood') {
                $scope.searchForm.latitude = walkService.distanceWidget.getCenter().lat();
                $scope.searchForm.longitude = walkService.distanceWidget.getCenter().lng();
                $scope.searchForm.radius = walkService.distanceWidget.getRadius();
            }
            else {
                $scope.searchForm.latitude = "";
                $scope.searchForm.longitude = "";
                $scope.searchForm.radius = "";
            }
            if ($scope.searchForm.filter == 'cities') {
                $scope.searchForm.cities = Object.keys(walkService.cities).join(",");
            }
            else {
                $scope.searchForm.cities = "";
            }

            if ($scope.searchForm.filter == 'hausdorff' || $scope.searchForm.filter == 'crossing') {
                $scope.searchForm.searchPath = walkService.pathManager.getEncodedSelection();
            }
            else {
                $scope.searchForm.searchPath = "";
            }
            $http.get('/search?' + $.param($scope.searchForm)).success(function (data) {
                searchCallback(data, false);
            });
        };
        $scope.getNext = function (params) {
            $http.get('/search?' + params).success(function (data)
            {
                searchCallback(data, false, true);
            });
        };

        $scope.showModal = function () {
            $scope.path_json = walkService.pathManager.selectionAsGeoJSON();
            $(walkService.modal).modal('show');
        };
        $scope.showAdmin = function (item, ev) {
	    if (ev) ev.stopImmediatePropagation();

	    if ( !item && !walkService.pathManager.selection ) {
		alert('draw or select a path on map');
		return;
	    }
	    if (item) {
console.log(item.date);
                $scope.selection = angular.copy(item);		
                $scope.update_path = false;
                $scope.update_path_disabled = !walkService.pathManager.selection;
	    }
	    else {
		$scope.selection = {};		
                $scope.update_path = true;
	    }
            $(walkService.admin).modal('show');
        };
        $scope.showInfo = function (item, ev) {
            ev.stopImmediatePropagation();
            $scope.info_comment = item.comment;
            var href = location.protocol + "//" + location.host + "?id=" + item.id;
            var body = item.date + ': ' + item.title + ' (' + $filter('number')(item.length, 1) + 'km)';
            var link = angular.element('<a></a>');
            link.attr('href', href);
            link.attr('target', '_blank');
            link.text(body);
            if (item.comment) link.attr('title', item.comment);
            $scope.info_link = link.get(0).outerHTML;
            $scope.info_url  = href;
            $scope.twitter_params = 'text=' + encodeURIComponent($scope.info_title) + '&url=' + encodeURIComponent($scope.info_uri);
            var elm = angular.element('<a href="https://twitter.com/share" class="twitter-share-button" data-lang="en"  data-count="none" data-size="large">Tweet</a>');
            elm.attr('data-hashtags', $('#twitter_div').attr('data-hashtags'));
            elm.attr('data-text', body);
            elm.attr('data-url', href);
            $('#twitter_div').html(elm);
            console.log($('#twitter_div').html());
            twttr.widgets.load();
            $(walkService.info).modal('show');
        };
        $scope.resetCities = function () {
            Object.keys(walkService.cities).forEach(function (id) {
                walkService.cities[id].setMap(null);
            });
            walkService.cities = {};
        };
        $scope.setRadius = function (r) {
            walkService.distanceWidget.setRadius(r);
        }

        $scope.showPath = function (id) {
	    var data = $scope.result[id];
            if (data) {
                walkService.pathManager.showPath(data.path, true);
		if ($scope.isMobile) {
		    $scope.tooltip = data.date + ": " + data.title + " (" + (Math.round(data.length*10)/10) + "km)";
		    $("#panel-search").panel("close");
		    setTimeout(function () {
			$("#tooltip").popup("open");
		    }, 1000);
		    setTimeout(function () {
			$("#tooltip").popup("close");
		    }, 4000);
		    
		}
            }
            return false;

        };
        $scope.showPaths = function () {
            for (var id in $scope.result) {
                walkService.pathManager.showPath($scope.result[id].path, false);
            }
	    if ($scope.isMobile) {
		$("#panel-search").panel("close");
	    }
            return false;
        };

        $scope.download = function (id, ev) {
            ev.stopImmediatePropagation();
            window.location.href= "/export/" + id;
        };
        $scope.export = function () {
            var ids =  Object.keys($scope.result).filter(function (item, index, array) {
                return $scope.result[item];
            });
            var form = $('#result_form').clone();
            form.attr({
                method : 'POST',
                action : '/export'
            });
            form.submit();
        };

        $scope.checkAllResult = function () {
            for (var item in $scope.result) {
                $scope.result[item] = true;
            }
            return false;
        };

        $scope.resetResult = function () {
            for (var item in $scope.result) {
                $scope.result[item] = false;
            }
            return false;
        };

        $scope.deletePath = function ()  {
            walkService.pathManager.deletePath();
        };
        $scope.deleteAll = function ()  {
            walkService.pathManager.deleteAll();
        };

        $scope.destroy = function () {
            if ($scope.selection.id && confirm('Are you shure to delete?')) {
                $http.get('/destroy/' + $scope.selection.id).success(function (data) {
                    $scope.selection = {};
                    $(walkService.admin).modal('hide');
                }).error(function (data) {
                    alert(data);
                });
            }
        };
        $scope.save = function () {
            if ($scope.selection.id && ! confirm('Are you shure to overwrite?')) {
                return;
            }
            $scope.selection.path = $scope.update_path ? walkService.pathManager.getEncodedSelection() : null;
            $http.post('/save', $scope.selection).success(function (data) {
                $scope.selection = data[0];
                // fix date format after saving
                data[0].date = $filter('date')(data[0].date, 'yyyy-MM-dd');
                $(walkService.admin).modal('hide');
                $scope.walks = data;
                $scope.total_count = null;
                $scope.params = null;
            }).error(function (data) {
                alert(data);
            });
        };
        $scope.resetAdminForm = function () {
            $scope.selection = {};
        };
        $scope.showElevation = function () {
            $scope.currentService = 'elevation';
            walkService.requestElevation();
        };
        $scope.showPanorama = function () {
            walkService.panorama.setVisible(true);
            walkService.showPanorama();
            $scope.currentService = 'panorama';
            $scope.panoramaIndex = walkService.panoramaIndex+1;
            $scope.panoramaCount = walkService.panoramaCount;
        };
        $scope.closeService = function () {
            $scope.currentService = 'none';
        };

        $scope.$watch('searchForm.filter', function (newValue, prevValue) {
            walkService.showDistanceWidget(newValue == 'neighborhood');
            walkService.showCities(newValue == 'cities');
            if (newValue != 'neighborhood' && newValue != 'hausdorff' &&
		$scope.searchForm.order == 'nearest_first') {
		$scope.searchForm.order = 'newest_first';
	    }
	    if (newValue != 'any' && $scope.isMobile) {
		if ($scope.isMobile) {
		    $("#panel-search").panel("close");
		}
	    }
	    
        });
        $scope.$watch('editable', function (newValue, prevValue) {
            if (walkService.pathManager.get('editable') != newValue)
            walkService.pathManager.set('editable', newValue);
        });
        $scope.$watch('currentService', function (newValue, prevValue) {
            //	    $scope.mapClass = 'map-with-' + newValue;
            setTimeout(function () {
                google.maps.event.trigger(walkService.map, 'resize');
            }, 0);
        });

        $scope.nextPanorama = function (){
            walkService.panoramaIndex ++;
            walkService.showPanorama();
            $scope.panoramaIndex = walkService.panoramaIndex+1;
        };

        $scope.prevPanorama = function (){
            walkService.panoramaIndex --;
            walkService.showPanorama();
            $scope.panoramaIndex = walkService.panoramaIndex+1;
        };
        $scope.backwardPanorama = function (){
            walkService.panoramaIndex -= 10;
            walkService.showPanorama();
            $scope.panoramaIndex = walkService.panoramaIndex+1;
        };
        $scope.forwardPanorama = function () {
            walkService.panoramaIndex += 10;
            walkService.showPanorama();
            $scope.panoramaIndex = walkService.panoramaIndex+1;
        };
        $scope.importJSON = function (json) {
            walkService.importJSON(json);
            $(walkService.modal).modal('hide');
        };
        $scope.stop_event = function (ev) {
            ev.stopImmediatePropagation();
            return true;
        };
        $scope.geocoderSearch = function (address) {
            walkService.geocoderSearch(address);
        }
        $(document).bind("drop", function (e) {
            e.stopPropagation();
            e.preventDefault();
        }).bind("dragenter", function (e) {
            e.stopPropagation();
            e.preventDefault();
        }).bind("dragover", function (e) {
            e.stopPropagation();
            e.preventDefault();
        });

    });

})(this);
