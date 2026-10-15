#!/usr/bin/env python3
"""Import REAL user-supplied ESRI ASCII DEM samples as Blue Hour v8-compatible region strips.

No external GIS dependencies. Both raster and route CSV MUST use the SAME planar
projected coordinate system and metre units. Imported offsets affect far terrain
only; procedural road/path elevation is not georeferenced or modified.
"""
from __future__ import annotations
import argparse, csv, hashlib, json, math, re
from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path

REGION_M=256
MAX_CELLS=4_000_000
MAX_BYTES=70*1024*1024
OUTPUT=Path(__file__).resolve().parent/'assets'/'regions'

@dataclass(frozen=True)
class Grid:
    cols:int
    rows:int
    x0:float  # cell center of westernmost column
    y0:float  # cell center of southernmost row
    resolution:float
    values:tuple[float,...]  # north-to-south rows
    nodata:float|None

    def at(self,x:float,y:float)->float:
        a=(x-self.x0)/self.resolution
        b=(y-self.y0)/self.resolution
        # Bilinear samples strictly within raster cell-centre bounds.
        if not (0<=a<=self.cols-1 and 0<=b<=self.rows-1):
            raise ValueError(f'DEM coverage missing at ({x:.2f}, {y:.2f})')
        ix=min(self.cols-2,int(a)); iy=min(self.rows-2,int(b))
        if ix<0 or iy<0:raise ValueError('DEM needs at least 2x2 cells')
        u=a-ix; v=b-iy
        # Grid input stored row 0 = northernmost raster row.
        def sample(dx:int,dy:int)->float:
            val=self.values[(self.rows-1-(iy+dy))*self.cols+(ix+dx)]
            if not math.isfinite(val) or (self.nodata is not None and val==self.nodata):
                raise ValueError(f'DEM NoData in sampling stencil at ({x:.2f}, {y:.2f})')
            return val
        return (1-v)*((1-u)*sample(0,0)+u*sample(1,0))+v*((1-u)*sample(0,1)+u*sample(1,1))


def read_ascii_grid(filename:Path)->Grid:
    if filename.stat().st_size>MAX_BYTES:raise ValueError('DEM ASCII exceeds 70 MiB input limit')
    headers={}; data=[]
    with filename.open(encoding='utf-8-sig') as f:
        for line in f:
            stripped=line.strip()
            if not stripped:continue
            fields=stripped.split()
            key=fields[0].lower()
            if not data and key in {'ncols','nrows','xllcorner','xllcenter','yllcorner','yllcenter','cellsize','nodata_value'}:
                if len(fields)!=2 or key in headers:raise ValueError('Duplicate/malformed DEM header')
                headers[key]=float(fields[1]);continue
            data.extend(fields)
            if len(data)>MAX_CELLS:raise ValueError('DEM too many cells')
    required=('ncols','nrows','cellsize')
    if any(k not in headers for k in required):raise ValueError('DEM missing dimensions/cellsize')
    cols,rows=int(headers['ncols']),int(headers['nrows'])
    step=headers['cellsize']
    if cols<2 or rows<2 or cols*rows>MAX_CELLS or step<=0 or not math.isfinite(step):
        raise ValueError('Unsupported DEM dimensions, cells or spacing')
    if cols!=headers['ncols'] or rows!=headers['nrows'] or len(data)!=cols*rows:
        raise ValueError('DEM cell count mismatch')
    if 'xllcenter' in headers:x0=headers['xllcenter']
    elif 'xllcorner' in headers:x0=headers['xllcorner']+step/2
    else:raise ValueError('Missing xllcorner/xllcenter')
    if 'yllcenter' in headers:y0=headers['yllcenter']
    elif 'yllcorner' in headers:y0=headers['yllcorner']+step/2
    else:raise ValueError('Missing yllcorner/yllcenter')
    vals=tuple(map(float,data));nodata=headers.get('nodata_value')
    if not all(math.isfinite(v) or v==nodata for v in vals):
        raise ValueError('Nonfinite DEM values')
    return Grid(cols,rows,x0,y0,step,vals,nodata)


def read_route(filename:Path):
    points=[]
    with filename.open(newline='',encoding='utf-8-sig') as f:
        reader=csv.DictReader(f)
        if not reader.fieldnames or not {'station_m','x_m','y_m'}.issubset(reader.fieldnames):
            raise ValueError('Route CSV needs station_m,x_m,y_m headers')
        for line in reader:
            p=tuple(float(line[k]) for k in ('station_m','x_m','y_m'))
            if not all(map(math.isfinite,p)) or p[0]<0:raise ValueError('Invalid route control point')
            if points and p[0]<=points[-1][0]:raise ValueError('Stations must increase strictly')
            points.append(p)
            if len(points)>100000:raise ValueError('Too many route points')
    if len(points)<2:raise ValueError('At least two route control points required')
    if points[0][0]>0:raise ValueError('Route must include station 0')
    return points


def route_xy(points,s):
    stations=[p[0] for p in points]
    if s<stations[0] or s>stations[-1]:raise ValueError(f'Route has no coverage at station {s:.2f}')
    i=max(0,min(len(points)-2,bisect_right(stations,s)-1))
    a,b=points[i],points[i+1];t=(s-a[0])/(b[0]-a[0]);return (a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2]))


def route_right(points,s):
    low=max(0,s-0.5);high=min(points[-1][0],s+0.5)
    a=route_xy(points,low);b=route_xy(points,high)
    dx,dy=b[0]-a[0],b[1]-a[1];mag=math.hypot(dx,dy)
    if mag<1e-8:raise ValueError(f'Degenerate route tangent at station {s}')
    return (dy/mag,-dx/mag)


def sample_region(grid,points,region_id,scale):
    start=region_id*REGION_M
    west=[];east=[]
    for i in range(9):
        station=start+i*32
        x,y=route_xy(points,station)
        nx,ny=route_right(points,station)
        road=grid.at(x,y)
        for lat,output in ((-1,west),(1,east)):
            for j in range(9):
                offset=lat*(90+j*35)
                sample=grid.at(x+nx*offset,y+ny*offset)
                value=(sample-road)*scale
                # Strict, not silently clamped. Browser-side descriptor contract ±40m.
                if not math.isfinite(value) or abs(value)>40:
                    raise ValueError(f'Offset ±40 m exceeded at region {region_id} station {station}, lateral {offset}: {value:.2f} m. Explicitly adjust --height-scale if appropriate.')
                output.append(round(value,4))
    return {'rows':9,'columns':9,'west':west,'east':east}


def import_regions(dem_path,route_path,start,count,height_scale=1.0,overwrite=False,crs='unspecified',dest=OUTPUT):
    if start<0 or count<1 or count>128 or start+count>10000000:raise ValueError('Invalid region range')
    if not 0<height_scale<=4:raise ValueError('height-scale must be (0,4]')
    if not re.fullmatch(r'[A-Za-z0-9_:+. -]{1,64}',crs):raise ValueError('Invalid CRS label')
    grid=read_ascii_grid(dem_path);points=read_route(route_path)
    # Validate all input/raster extents before changing existing files.
    generated={}
    for id in range(start,start+count):
        file=dest/f'region_{id:06d}.json'
        if file.exists() and not overwrite:raise FileExistsError(f'{file} exists; use --overwrite explicitly')
        field=sample_region(grid,points,id,height_scale)
        rseed=(id*2654435761 ^ 20261014)&0xffffffff
        # Stable metadata, same validation schema as v8.
        original=json.loads(file.read_text()) if file.exists() else {}
        biome=original.get('biome','pine')
        generated[file]={'id':id,'biome':biome,'seed':int(original.get('seed',rseed)),
                         'density':float(original.get('density',0.75)),
                         'relief':float(original.get('relief',0.95)),
                         'tint':float(original.get('tint',0)),
                         'heightfield':field}
    dest.mkdir(parents=True,exist_ok=True)
    for file,obj in generated.items():
        raw=json.dumps(obj,indent=2)+'\n'
        if len(raw.encode('utf8'))>16384:raise ValueError('Descriptor exceeds 16 KiB limit')
    for file,obj in generated.items():
        temp=file.with_suffix('.json.tmp');temp.write_text(json.dumps(obj,indent=2)+'\n');temp.replace(file)
    entries=[]
    for file in sorted(dest.glob('region_*.json')):
        if not re.fullmatch(r'region_\d{6,8}\.json',file.name):continue
        rid=int(file.stem.split('_')[-1]);entries.append({'id':rid,'path':f'./assets/regions/{file.name}'})
    if len(entries)>1024:raise ValueError('Manifest 1024 entry limit exceeded')
    manifest={'schema':'bluehour-region-v1','regions':entries}
    (dest/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    report={
        'source_type':'ESRI ASCII grid','classification':'user-supplied data, not independently verified',
        'dem_file':dem_path.name,'dem_sha256':hashlib.sha256(dem_path.read_bytes()).hexdigest(),
        'route_file':route_path.name,'route_sha256':hashlib.sha256(route_path.read_bytes()).hexdigest(),
        'crs_label':crs,'height_units':'metres','route_coordinate_units':'projected metres',
        'height_scale':height_scale,'absolute_elevation_preserved':False,
        'road_georeferenced':False,'regions_created':count,'region_start':start,
        'offset_interpretation':'DEM altitude minus DEM road-center altitude at the same station',
        'warning':'Far scenery only; road geometry and driving physics remain synthetic. No automatic CRS transformation.'
    }
    (dest/'dem_import_report.json').write_text(json.dumps(report,indent=2)+'\n')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dem',type=Path,required=True,help='Projected ESRI ASCII grid (.asc), coordinate units metres')
    p.add_argument('--route',type=Path,required=True,help='station_m,x_m,y_m CSV in same CRS as DEM')
    p.add_argument('--start',type=int,default=0)
    p.add_argument('--count',type=int,default=4)
    p.add_argument('--height-scale',type=float,default=1.)
    p.add_argument('--crs',default='unspecified')
    p.add_argument('--overwrite',action='store_true')
    a=p.parse_args()
    result=import_regions(a.dem,a.route,a.start,a.count,a.height_scale,a.overwrite,a.crs)
    print('Imported',result['regions_created'],'regions. Review assets/regions/dem_import_report.json')
