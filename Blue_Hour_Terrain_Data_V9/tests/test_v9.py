#!/usr/bin/env python3
"""Real-data importer, sprite-atlas installer and integration regression tests."""
from pathlib import Path
import json,re,subprocess,tempfile,math,sys
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from import_dem import Grid,read_ascii_grid,read_route,import_regions,route_xy,sample_region
from install_impostors import install
html=(ROOT/'index.html').read_text()
for marker in [
 'V9_GEOSPATIAL_ASSETS_END','instanceAtlasIndex','onBeforeCompile',
 'loadImpostorAtlas();','cullRegionsByCamera();','gpuPercentiles()',
 'this.atlasIDs.array[i]','this.spriteGeometry=worldSpritePlane.clone()',
 'sampleRegionHeight(descriptor','regionStore.initialize()','maintainRegions()',
 'this.boundingSphere.radius+=90','Atlas image dimensions mismatch'
]:
 assert marker in html,marker
assert 'BlueHourV9InstancedAtlas' in html
with tempfile.TemporaryDirectory() as td:
 tmp=Path(td)
 js=html.split('<script type="module">')[-1].split('</script>')[0]
 (tmp/'source.mjs').write_text(js)
 subprocess.run(['node','--check',str(tmp/'source.mjs')],check=True,capture_output=True)
 width=140;height=160;step=10
 # Real projected coordinate test fixture: exact planar elevation with no raster noise.
 dem=tmp/'example.asc'
 rows=['ncols 140','nrows 160','xllcorner -200','yllcorner -100',
       'cellsize 10','NODATA_value -9999']
 for r in range(height):
  y=-95+(height-1-r)*step
  rows.append(' '.join(f'{400+.02*(-195+c*step)+.01*y:.5f}' for c in range(width)))
 dem.write_text('\n'.join(rows)+'\n')
 route=tmp/'route.csv';route.write_text('station_m,x_m,y_m\n0,500,150\n1024,500,1174\n')
 grid=read_ascii_grid(dem)
 assert abs(grid.at(500,150)-(400+.02*500+.01*150))<.0001
 points=read_route(route)
 assert route_xy(points,400)==(500,550)
 field=sample_region(grid,points,0,1)
 assert len(field['east'])==81
 assert abs(field['east'][0]-1.8)<.001 and abs(field['west'][0]+1.8)<.001
 folder=tmp/'project'/'assets'/'regions'
 report=import_regions(dem,route,0,2,1,False,'EPSG:32632',folder)
 assert report['regions_created']==2 and report['road_georeferenced'] is False
 for i in range(2):
  d=json.loads((folder/f'region_{i:06d}.json').read_text())
  assert d['id']==i and len(d['heightfield']['west'])==81
  assert (folder/f'region_{i:06d}.json').stat().st_size<16384
 assert (folder/'manifest.json').exists()
 try:import_regions(dem,route,0,1,1,False,'EPSG:32632',folder)
 except FileExistsError:pass
 else:raise AssertionError('Non-overwrite DEM import should refuse replacement')
 badroute=tmp/'badroute.csv';badroute.write_text('station_m,x_m,y_m\n0,500,150\n100,500,250\n90,500,240\n')
 try:read_route(badroute)
 except ValueError:pass
 else:raise AssertionError('Invalid stations accepted')
 raster=tmp/'raster.png'
 pic=Image.new('RGBA',(512,128),(0,0,0,0));draw=ImageDraw.Draw(pic)
 for i in range(4):draw.polygon([(i*128+64,8),(i*128+112,120),(i*128+16,120)],fill=(40+i*24,115,80,250))
 pic.save(raster)
 result=install(raster,'CC0','synthetic unit fixture',tmp/'asset_install')
 assert result['columns']==4 and len(result['sha256'])==64
 assert (tmp/'asset_install/assets/impostors/forest_atlas.png').exists()
 bad=tmp/'rgb.png';Image.new('RGB',(512,128),'green').save(bad)
 try:install(bad,'CC0',target_root=tmp)
 except ValueError:pass
 else:raise AssertionError('RGB atlas unexpectedly accepted')
print('PASS v9 DEM projected-grid importer, geospatial residual contract, strict safety checks, RGBA atlas installer and HTML hooks')
