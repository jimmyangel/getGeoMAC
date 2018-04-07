## getGeoMAC - Get a snapshot of [GeoMAC](https://www.geomac.gov/) data in TopoJSON format

```
Usage:
  getGeoMAC.js [OPTIONS] [ARGS]

Options:
  -s, --state [STRING]   State (Default is Oregon)
  -y, --year [STRING]    Year (Default is current_year)
  -d, --dest [FILE]      Destination directory (Default is rcwildfires-data)
  -h, --help             Display help and usage details
```
#### Examples:

Get current year data for the state of Oregon
```
node getGeoMAC.js
```
Get current year data for the state of California
```
node getGeoMAC.js -s California
```
Get 2017 data for the state of Oregon
```
node getGeoMAC.js -y 2017
```
Get 2017 data for the state of California and save the data in the 'test' directory
```
node getGeoMAC.js -y 2017 -s California -d test
```
