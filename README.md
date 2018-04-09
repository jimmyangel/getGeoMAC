## getGeoMAC - Get a snapshot of [GeoMAC](https://www.geomac.gov/) data in TopoJSON format

This utility retrieves a collection of fire perimeter files published by GeoMAC in .shp format and converts
them to TopoJSON. All properties are preserved. The utility collects all individual perimeter files for a every fire and combines them
into a single TopoJSON file per fire. The utility also produces a JSON summary file with a list of
all fires processed.

```
Usage:
  node getGeoMAC.js [OPTIONS] [ARGS]

Options:
  -s, --state [STRING]   State (Default is Oregon)
  -y, --year [STRING]    Year (Default is current_year)
  -d, --dest [FILE]      Destination directory (Default is rcwildfires-data)
  -v, --verbose BOOLEAN  Verbose logging
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
