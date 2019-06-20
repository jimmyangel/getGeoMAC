'use strict';

const cli = require('cli');
const log = require('simple-node-logger').createSimpleLogger();
const http = require('https');
const cheerio = require('cheerio');
const fs = require('fs');
const shapefile = require('shapefile');
const gp = require('geojson-precision');
const topojson = require('topojson-server');
const ThrottledPromise = require('throttled-promise');
const Cesium = require('cesium');
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIwMzE3NzI4MC1kM2QxLTQ4OGItOTRmMy1jZjNiMzgyZWNjMTEiLCJpZCI6ODMxLCJpYXQiOjE1MjU5Nzg4MDN9.Aw5ul-R15-PWF1eziTS9fOffIMjm02TL0eRtOD59v2s';

const MAX_PROMISES = 5;

const turf = require('@turf/turf');

const HOST = 'https://rmgsc.cr.usgs.gov';

log.setLevel('warn');

var forestland;
var forestlandArea;

var year;
var dest;

var options = cli.parse({
    state: ['s', 'State', 'string', 'Oregon'],
    year: ['y', 'Year', 'string', 'current_year'],
    dest: ['d', 'Destination directory', 'file', 'rcwildfires-data'],
    forest: ['f', 'Url of forestland GeoJSON (or \"ignore\")', 'string', 'https://stable-data.oregonhowl.org/oregon/forestland.json'],
    verbose: ['v', 'Verbose logging', 'boolean', false],
    noelev: ['n', 'Skip elevation data', 'boolean', false],
    help: ['h', 'Display help and usage details']
});

if (options.help) {
  console.log('getGeoMAC - Get a snapshot of GeoMAC data in TopoJSON format\n');
  cli.getUsage();
} else {
  let state = options.state ? options.state : 'Oregon';
  year = options.year ? options.year : 'current_year';
  dest = options.dest ? options.dest : 'rcwildfires-data';
  let path = '/outgoing/GeoMAC/' + year + '_fire_data/';
  if (options.verbose) {log.setLevel('info');}
  if (options.forest !== 'ignore') {
    retrieveDocByUrl(options.forest).then((result) => {
      forestland = turf.flatten(JSON.parse(result));
      forestlandArea = turf.area(forestland);
      doGetGeoMACData (path, state);
    }).catch((err) => {
      log.error('Error reading forestland url: ', err);
      process.exitCode = 1;
    });
  } else {
    doGetGeoMACData (path, state);
  }
}

function doGetGeoMACData (path, state) {
  try {fs.mkdirSync(dest + '/');} catch(err) {if (err.code !== 'EEXIST') {throw(err);}}
  try {fs.mkdirSync(dest + '/' + year);} catch (err) {if (err.code !== 'EEXIST') {throw(err);}}

  log.info('Getting GeoMac data...');

  retrieveDocByUrl(HOST + path + state + '/').then(listData => {
    let $ = cheerio.load(listData);
    let p = [];
    $('a').each(function () {
      let link = $(this).attr('href');
      if (link !== path) {
        let fileName = link.substring(link.indexOf(path) + (path + state).length + 1, link.length - 1);
        let name = decodeURIComponent(fileName.replace(/_(?!$)/g, ' '));

        let dp = (function () {
          return new ThrottledPromise((resolve, reject) => {
            retrieveDocByUrl(HOST + link).then(listData => {
              let $ = cheerio.load(listData);
              let fireRecord = {fireYear: year, fireName: name, fireFileName: fileName, fireLink: link, fireReports: [], fireMaxAcres: 0, bbox: [180, 90, -180, -90], location: [0, 0]};
              $('a').each(function () {
                let rlink = $(this).attr('href');
                if ((rlink !== path + state) + '/' && (rlink.endsWith('.shp'))) {
                  let xdate = rlink.replace(/%20/g, ' ').substr(link.length + fileName.length + 4).substr(0, 13);
                  let date = new Date(xdate.substr(0, 4) + '-' + xdate.substr(4, 2) + '-' + xdate.substr(6, 2) + 'T' + xdate.substr(9, 2) + ':' + xdate.substr(11, 2));
                  if (date instanceof Date && isFinite(date)) {
                    fireRecord.fireReports.push({fireReportLink: rlink, fireReportDate: date});
                  }
                }
              });
              resolve(fireRecord);
            }).catch((err) => {
              reject(err);
            });
          });
        })();
        p.push(dp);
      }
    });
    ThrottledPromise.all(p, MAX_PROMISES).then(values => {
      processFireRecords(values);
    }).catch((err) => {
      if (err.code === 'ENOTFOUND') {
        log.warn(`No ${state} data available for ${year}`);
      } else {
        log.error(err);
        process.exitCode = 1;
      }
    });
  }).catch((err) => {
    log.error(err);
    process.exitCode = 1;
  });
}

function retrieveDocByUrl(url) {

  return new Promise((resolve, reject) => {

    http.get(url, (res) => {
      let result = '';
      res.on('data', (chunk) => {
        result += chunk;
      });
      res.on('end', () => {
        resolve(result);
      });
      res.on('error', (err) => {
        reject(err);
      });
    }).on('error', err => {
      reject(err);
    });

  });
}

function processFireRecords(fireRecords) {

  let p = [];
  fireRecords.forEach(function (fireRecord) {
    let dp = fireRecordTask(fireRecord);
    p.push(dp);
  });
  ThrottledPromise.all(p, 2).then(() => {
    fireRecords = fireRecords.filter(fireRecord => fireRecord.fireMaxAcres > 1000);

    fireRecords.forEach((fr, i) => delete fireRecords[i].fireLink);

    updateElevations(fireRecords, function(fR) { // Get elevations
      log.info('Process complete');
      fs.writeFile(dest+ '/' + year + 'fireRecords.json', JSON.stringify(fR), (error) => {
        if (error) {
          log.error(error);
          process.exitCode = 1;
          throw(error);
        }
      });
    });
  }).catch(error => {
    log.error('processFireRecords', error.stack);
    process.exitCode = 1;
  });
}

function fireRecordTask (fireRecord) {
  let p = [];
  return new ThrottledPromise((resolve, reject) => {
    fireRecord.fireReports.forEach(function (fireReport) {
      let dp = fireReportTask(fireRecord, fireReport);
      p.push(dp);
    });
    ThrottledPromise.all(p, 3).then((geoJSONFireReports) => {
      if (fireRecord.fireMaxAcres > 1000) {
        fireRecord.location = [
          Number(((fireRecord.bbox[0]+fireRecord.bbox[2])/2).toFixed(5)),
          Number(((fireRecord.bbox[1]+fireRecord.bbox[3])/2).toFixed(5))
        ];
        fireRecord.fireMaxAcres = Number((fireRecord.fireMaxAcres).toFixed(0));
        let wrapFireReports = {type: 'FeatureCollection', features: geoJSONFireReports};
        fs.writeFile(dest + '/' + year + '/' + fireRecord.fireFileName + '.json', JSON.stringify(topojson.topology({collection: wrapFireReports})), (error) => {
          if (error) {
            log.error(error);
            reject(error);
          }
        });
        log.info('Completed processing ', fireRecord.fireFileName);
      }

      resolve();
    }).catch(error => {
      log.error('fireRecordTask', error.stack);
      reject(error);
    });
  });
}

function fireReportTask (fireRecord, fireReport) {
  return new ThrottledPromise((resolve, reject) => {

    http.get(HOST + fireReport.fireReportLink.substring(0, fireReport.fireReportLink.length - 3) + 'dbf', (dres) => {

      http.get(HOST + fireReport.fireReportLink, (res) => {
        shapefile.read(res, dres).then(function (result) {
          result.bbox = result.bbox.map(x => Number(x.toFixed(5)));
          let bbox = fireRecord.bbox;
          bbox[0] = Math.min(bbox[0], result.bbox[0]);
          bbox[1] = Math.min(bbox[1], result.bbox[1]);
          bbox[2] = Math.max(bbox[2], result.bbox[2]);
          bbox[3] = Math.max(bbox[3], result.bbox[3]);
          fireRecord.bbox = bbox;
          result.features[0].properties.GISACRES = result.features[0].properties.GISACRES ? result.features[0].properties.GISACRES : result.features[0].properties.gisAcres;
          if (result.features[0].properties.GISACRES) {
            fireRecord.fireMaxAcres = Math.max(result.features[0].properties.GISACRES, fireRecord.fireMaxAcres);
            fireReport.fireReportAcres = Number(result.features[0].properties.GISACRES).toFixed(0);
          }
          if (result.features[0].properties.inciwebId && !fireRecord.inciwebId) {
            fireRecord.inciwebId = result.features[0].properties.inciwebId;
          }
          result.features[0].properties.fireReportDate = fireReport.fireReportDate;
          delete fireReport.fireReportLink; // We are done with this
          log.info('Processed fire report ', fireRecord.fireName, ' ', result.features[0].properties.fireReportDate, ' ', result.features[0].properties.GISACRES);

          let resultFeature = gp(result, 5).features[0];

          // Compute percent forest for last report and save it on the fireRecord entry
          if ((forestland) && (fireRecord.fireReports[fireRecord.fireReports.length-1].fireReportDate === fireReport.fireReportDate)) {
            fireRecord.percentForest = computeForestLandPercent(resultFeature);
          }

          resolve(resultFeature);
        }).catch(error => {
          log.error('fireReportTask', error.stack);
          reject(error);
        });
      });
    });
  });
}

function computeForestLandPercent(shape) {

  let area = turf.area(shape);
  let iArea = 0;

  if (area > 0) {
    let fShape = turf.flatten(shape);
    fShape.features.forEach(function (feature) {
      if (turf.area(feature)) {
        forestland.features.forEach(function (forest) {
          if (turf.area(forest)) {
            let intersection;
            // Sometimes shapes are crappy, so ignore those
            try {
              intersection = turf.intersect(turf.simplify(feature, {tolerance: 0.0001}), forest);
            } catch (e) {
            }
            if (intersection) {
                iArea += turf.area(intersection);
            }
          }
        });
      }
    });
    return Math.round(100*(iArea/area));
  }
  return 0;
}

function updateElevations(fireRecords, callback) {
  if (options.noelev) {
    log.info('Skipping elevation data');
    return callback(fireRecords);
  };

  let pos = [];
  fireRecords.forEach(function(f) {
    pos.push(Cesium.Cartographic.fromDegrees(f.location[0], f.location[1]));
  });

  let tp = Cesium.createWorldTerrain();

  log.info('Getting elevation data');

  tp.readyPromise.then(function() {
    Cesium.sampleTerrainMostDetailed(tp, pos).then(function(updPos) {
      updPos.forEach(function(p, i) {
        fireRecords[i].location.push(Number(p.height.toFixed(2)));
      });
      return callback(fireRecords);
    });
  }).otherwise(function (err) {
    log.error('Error getting elevation data ', err);
    process.exitCode = 1;
  });
}
