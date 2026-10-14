"""Run INSIDE the Unreal Editor: Tools > Execute Python Script > this file.
Requires Python Editor Script Plugin and Editor Scripting Utilities.
Full car imports take time. Keep Unreal open until the import reports done.
"""
from pathlib import Path
import unreal

ROOT=Path(unreal.Paths.project_dir()).resolve()
TEX_ROOT=ROOT/'Content'/'GeneratedTextures'
CAR_ROOT=ROOT/'Import'
ASSETS=unreal.AssetToolsHelpers.get_asset_tools()
EL=unreal.EditorAssetLibrary
MEL=unreal.MaterialEditingLibrary
NAMES=['Asphalt','Ground','Gravel','Stone','Bark','Foliage','Wood','Leather','BrushedMetal','PaintCar','Paint']
PARTS=['CAR_BODY','FL_WHEEL','FR_WHEEL','RL_WHEEL','RR_WHEEL']

def log(msg):
    unreal.log('[DB4 SETUP] '+str(msg))

def import_file(file,dest):
    if not file.exists():raise FileNotFoundError(file)
    task=unreal.AssetImportTask()
    task.filename=str(file)
    task.destination_path=dest
    task.automated=True
    task.replace_existing=False
    task.save=True
    ASSETS.import_asset_tasks([task])
    return [str(x) for x in task.get_editor_property('imported_object_paths')]

def material(name):
    path=f'/Game/DB4/Materials/M_{name}'
    if EL.does_asset_exist(path):return unreal.load_asset(path)
    factory=unreal.MaterialFactoryNew()
    return ASSETS.create_asset(f'M_{name}','/Game/DB4/Materials',unreal.Material,factory)

def tex(name,channel):
    return unreal.load_asset(f'/Game/DB4/Textures/T_{name}_{channel}')

def sample(mat,texture,x,y):
    node=MEL.create_material_expression(mat,unreal.MaterialExpressionTextureSample,x,y)
    node.set_editor_property('texture',texture)
    return node

def mask(mat,input_node,channel,x,y):
    node=MEL.create_material_expression(mat,unreal.MaterialExpressionComponentMask,x,y)
    node.set_editor_property('r',channel=='r')
    node.set_editor_property('g',channel=='g')
    node.set_editor_property('b',channel=='b')
    MEL.connect_material_expressions(input_node,'RGB',node,'Input')
    return node

def build_materials():
    for name in NAMES:
        m=material(name)
        if not m:
            log('ERROR material factory failed '+name);continue
        # Keep the asset idempotent: re-run rebuilds the material graph from scratch.
        MEL.delete_all_material_expressions(m)
        base=sample(m,tex(name,'BaseColor'),-440,-280)
        nrm=sample(m,tex(name,'Normal'),-440,-20)
        orm=sample(m,tex(name,'ORM'),-440,235)
        rough=mask(m,orm,'g',-175,180)
        metal=mask(m,orm,'b',-175,330)
        MEL.connect_material_property(base,'RGB',unreal.MaterialProperty.MP_BASE_COLOR)
        MEL.connect_material_property(nrm,'RGB',unreal.MaterialProperty.MP_NORMAL)
        MEL.connect_material_property(rough,'',unreal.MaterialProperty.MP_ROUGHNESS)
        MEL.connect_material_property(metal,'',unreal.MaterialProperty.MP_METALLIC)
        if name=='Foliage':m.set_editor_property('two_sided',True)
        MEL.layout_material_expressions(m)
        MEL.recompile_material(m)
        EL.save_loaded_asset(m)
        log('PBR material M_'+name)

def import_textures():
    for name in NAMES:
        for channel in ('BaseColor','Normal','ORM'):
            path=f'/Game/DB4/Textures/T_{name}_{channel}'
            if not EL.does_asset_exist(path):
                imported=import_file(TEX_ROOT/f'T_{name}_{channel}.png','/Game/DB4/Textures')
                log('Texture '+name+' '+channel+' '+str(imported))
            asset=unreal.load_asset(path)
            if not asset:
                log('FAILED to find '+path)
                continue
            if channel=='Normal':
                asset.set_editor_property('srgb',False)
                asset.set_editor_property('compression_settings',unreal.TextureCompressionSettings.TC_NORMALMAP)
            elif channel=='ORM':
                asset.set_editor_property('srgb',False)
            EL.save_loaded_asset(asset)

def import_car():
    for name in PARTS:
        expected=f'/Game/DB4/Car/{name}'
        if EL.does_asset_exist(expected):
            log('Existing car mesh '+name)
            continue
        # prefer the Blender-converted FBX — Interchange rejects several GLBs
        src=CAR_ROOT/f'{name}.fbx'
        if not src.exists():src=CAR_ROOT/f'{name}.glb'
        result=import_file(src,'/Game/DB4/Car')
        log('Imported GLB '+name+': '+str(result))
        if EL.does_asset_exist(expected):continue
        # Interchange may append a suffix; inspect the results and rename the one static mesh.
        for result_path in result:
            obj=unreal.load_asset(result_path)
            if isinstance(obj,unreal.StaticMesh):
                old=result_path.split('.')[0]
                if EL.rename_asset(old,expected):
                    log('Renamed imported mesh to '+expected)
                    break
        if not EL.does_asset_exist(expected):
            log('WARNING: Could not locate '+expected+'; manually rename the imported Static Mesh asset.')

def main():
    log('Starting texture, material, mesh import. Use source GLBs, not meshopt Web GLB.')
    import_textures();build_materials();import_car()
    EL.save_directory('/Game/DB4',only_if_is_dirty=True,recursive=True)
    log('IMPORT COMPLETE. Reopen the Unreal level or restart Play to pick up meshes/materials.')
    log('Expected assets: '+', '.join('/Game/DB4/Car/'+x for x in PARTS))

if __name__=='__main__':main()
