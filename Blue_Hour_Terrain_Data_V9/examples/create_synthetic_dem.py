#!/usr/bin/env python3
"""Create SMALL SYNTHETIC sample projected DEM and route CSV for importer demonstration.
These outputs are NOT real-world/survey elevation measurements.
"""
from pathlib import Path
import math
root=Path(__file__).resolve().parent
ncols,nrows,step=140,160,10
header=[f'ncols {ncols}',f'nrows {nrows}','xllcorner -200','yllcorner -100',
        f'cellsize {step}','NODATA_value -9999']
with (root/'demo_dem.asc').open('w') as out:
    out.write('\n'.join(header)+'\n')
    for r in range(nrows):
        y=-95+(nrows-1-r)*step
        out.write(' '.join(f'{380+.015*(-195+c*step)+.008*y+2*math.cos(c*.17):.3f}'
                           for c in range(ncols))+'\n')
(root/'demo_route.csv').write_text('station_m,x_m,y_m\n0,500,150\n1024,500,1174\n')
print('SYNTHETIC DEM and route controls written in examples/')
