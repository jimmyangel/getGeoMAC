const cli = require('cli');
const log = require('simple-node-logger').createSimpleLogger();
const http = require('https');
const cheerio = require('cheerio');
const fs = require('fs');
// const rimraf = require('rimraf');
const shapefile = require('shapefile');
const gp = require('geojson-precision');
const topojson = require('topojson-server');
const ThrottledPromise = require('throttled-promise');
const MAX_PROMISES = 5;
//const YEAR = 2017; // We will make this a parm later

const HOST = 'https://rmgsc.cr.usgs.gov';

log.setLevel('warn');

var year;
var dest;

var options = cli.parse({
    state: ['s', 'State', 'string', 'Oregon'],
    year: ['y', 'Year', 'string', 'current_year'],
    dest: ['d', 'Destination directory', 'file', 'rcwildfires-data'],
    verbose: ['v', 'Verbose logging', 'boolean', false],
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
  if (options.verbose) log.setLevel('info');
  doGetGeoMACData (path, state);
}

function doGetGeoMACData (path, state) {
  //rimraf.sync(dest);
  try {fs.mkdirSync(dest + '/');} catch(err) {if (err.code !== 'EEXIST') throw(err);}
  try {fs.mkdirSync(dest + '/' + year);} catch (err) {if (err.code !== 'EEXIST') throw(err);}

  retrieveList(HOST + path + state + '/').then(listData => {
    let $ = cheerio.load(listData);
    let p = [];
    $('a').each(function () {
      let link = $(this).attr('href');
      if (link != path) {
        let fileName = link.substring(link.indexOf(path) + (path + state).length + 1, link.length - 1);
        let name = fileName.replace(/_/g, ' ');
        //console.log('+++ Fire:', name, 'Url', HOST + link);

        let dp = (function () {
          return new ThrottledPromise((resolve, reject) => {
            retrieveList(HOST + link).then(listData => {
              let $ = cheerio.load(listData);
              let fireRecord = {fireYear: year, fireName: name, fireFileName: fileName, fireLink: link, fireReports: [], fireMaxAcres: 0, bbox: [180, 90, -180, -90], location: [0, 0]};
              $('a').each(function () {
                let rlink = $(this).attr('href');
                if ((rlink != path + state) + '/' && (rlink.endsWith('.shp'))) {
                  let xdate = rlink.substr(link.length + name.length + 4).substr(0, 13);
                  //console.log(xdate);
                  //let xdate = rlink.substr(rlink.length - 22).substr(0, 13);
                  let date = new Date(xdate.substr(0, 4) + '-' + xdate.substr(4, 2) + '-' + xdate.substr(6, 2) + 'T' + xdate.substr(9, 2) + ':' + xdate.substr(11, 2));
                  //console.log(rlink.substr(rlink.length - 22).substr(0, 13), 'xx', date);
                  fireRecord.fireReports.push({fireReportLink: rlink, fireReportDate: date});
                  //console.log(link);
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

function retrieveList(url) {

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
    log.info('Process complete');
    fireRecords = fireRecords.filter(fireRecord => fireRecord.fireMaxAcres > 1000);

    // We do not need these anymore
    //for (let i=0; i <fireRecords.length; i++)  {
    fireRecords.forEach((fr, i) => delete fireRecords[i].fireLink);
      //delete fireRecords[i].fireLink;
    //}

    fs.writeFile(dest+ '/' + year + 'fireRecords.json', JSON.stringify(fireRecords, null, 2), (error) => {
      if (error) {
        log.error(error);
        process.exitCode = 1;
        throw(error);
      }
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
          //console.log(fireRecord.bbox);
          if (result.features[0].properties.GISACRES) {
            fireRecord.fireMaxAcres = Math.max(result.features[0].properties.GISACRES, fireRecord.fireMaxAcres);
            fireReport.fireReportAcres = Number(result.features[0].properties.GISACRES).toFixed(0);
          }
          if (result.features[0].properties.inciwebId && !fireRecord.inciwebId) {
            fireRecord.inciwebId = result.features[0].properties.inciwebId;
          }
          result.features[0].properties.fireReportDate = fireReport.fireReportDate;
          delete fireReport.fireReportLink; // We are done with this
          log.info('Processed fire report ', fireRecord.fireName, result.features[0].properties.fireReportDate, result.features[0].properties.GISACRES);
          resolve(gp(result, 5).features[0]);
        }).catch(error => {
          log.error('fireReportTask', error.stack);
          reject(error);
        });
      });
    });
  });
}
