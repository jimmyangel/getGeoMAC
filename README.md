# Deprecated: GeoMAC was decomissioned in May 2020

## You can still retrieve data from 2010-2019 using this code

## For current data, take a look at [getNIFC](https://github.com/jimmyangel/getNIFC)

---

## getGeoMAC - Get a snapshot of [GeoMAC](https://www.geomac.gov/) data in TopoJSON format

This utility retrieves a collection of fire perimeter files published by GeoMAC in .shp format and converts
them to TopoJSON. All properties are preserved. The utility collects all individual perimeter files for a every fire and combines them
into a single TopoJSON file per fire.

The utility also produces a JSON summary file with a list of
all fires processed.

Percentage of forest land is calculated by intersecting the area of the last perimeter file with a GeoJSON shape of the forest land to intersect with (this functionality can be ignored).

In addition, elevation data is added to the location of
each fire in the summary file (this step can be skipped).

```
Usage:
  node getGeoMAC.js [OPTIONS] [ARGS]

  Options:
    -s, --state [STRING]   State (Default is Oregon)
    -y, --year [STRING]    Year (Default is current_year)
    -d, --dest [FILE]      Destination directory (Default is rcwildfires-data)
    -f, --forest [STRING]  Url of forestland GeoJSON (or "ignore") (Default is https://stable-data.oregonhowl.org/oregon/forestland.json)
    -v, --verbose BOOLEAN  Verbose logging
    -n, --noelev BOOLEAN   Skip elevation data
    -h, --help             Display help and usage details
```
#### Examples:

Get current year data for the state of Oregon
```
node getGeoMAC.js
```
Get current year data for the state of California
```
node getGeoMAC.js -s California -f https://example.com/california/forestland.json
```
Get current year data for the state of California, ignore forestland
```
node getGeoMAC.js -s California -f ignore
```
Get 2017 data for the state of Oregon
```
node getGeoMAC.js -y 2017
```
Get 2017 data for the state of California and save the data in the 'test' directory
```
node getGeoMAC.js -y 2017 -s California -d test
```
