"""Blue Hour — in-editor world builder for Unreal 5.8.

Run inside the editor:
    UnrealEditor-Cmd <path>/BlueHour.uproject \
        -ExecutePythonScript=<repo>/ue/tools/ue_setup.py \
        -staging=<repo>/ue/staging -unattended -nosplash -nullrhi?
or paste into the editor Python console with STAGING_DIR set below.

Phases (each independent + logged, so a failure degrades gracefully):
  1. import textures / models / terrain tiles / road / scatter CSV
  2. build materials (wet road, terrain vcolor blend, foliage, car paint)
  3. spawn terrain tiles + road with Nanite
  4. scatter trees/rocks/shrubs as instanced static meshes
  5. blue-hour lighting rig (SkyAtmosphere + sun + skylight + fog + PPV)
  6. route spline + drivable DB4 pawn (FloatingPawnMovement baseline)
  7. save level + assets
"""
import csv
import os
import sys

import unreal

STAGING = os.environ.get('BH_STAGING')
if not STAGING:
    for arg in sys.argv:
        if arg.startswith('-staging='):
            STAGING = arg.split('=', 1)[1]
if not STAGING:
    STAGING = '/Users/springchill/Documents/Blue_Hour_Cinematic_Package/ue/staging'

CONTENT = '/Game/BlueHour'
LEVEL = '/Game/BlueHour/Maps/L_BlueHour'

# blue-hour preset, mirroring src/core/config.js LIGHT_PRESETS[BLUE]
SUN_ELEV_DEG = -0.8
SUN_AZIM_DEG = 205.0
SUN_INTENSITY_LUX = 1.6
SUN_COLOR = unreal.LinearColor(0.70, 0.86, 1.0, 1.0)
FOG_DENSITY = 0.00035          # UE units are cm; js 0.0020 -> scaled
EXPOSURE_BIAS = -0.2
BLOOM = 0.36

arl = unreal.EditorAssetLibrary
lvl = unreal.EditorLevelLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()


def log(msg):
    unreal.log('[BlueHour] ' + msg)


def pkg(path):
    arl.make_directory(os.path.dirname(path))
    return path


_CLASS_ORDER = (unreal.SkeletalMesh, unreal.StaticMesh, unreal.Texture2D)


def import_file(src, dest):
    """Import one file -> dest package path. Returns the mesh/texture, not
    the auto-generated material (imported_object_paths lists everything)."""
    base = os.path.splitext(os.path.basename(src))[0]
    # reuse already-imported assets so a re-run is cheap
    for p in arl.list_assets(dest, recursive=True, include_folder=False):
        if p.rsplit('/', 1)[-1].split('.')[0] == base:
            a = unreal.load_asset(p.split('.')[0])
            if a:
                log('  reuse %s -> %s' % (os.path.basename(src), p))
                return a
    task = unreal.AssetImportTask()
    task.filename = src
    task.destination_path = dest
    task.automated = True
    task.replace_existing = True
    task.save = True
    if src.lower().endswith('.fbx'):
        opts = unreal.FbxImportUI()
        opts.import_mesh = True
        opts.import_textures = True
        opts.import_materials = True
        opts.static_mesh_import_data.combine_meshes = False
        task.options = opts
    tools.import_asset_tasks([task])
    imported = task.get_editor_property('imported_object_paths')
    if not imported:
        log('  !! import produced no objects: ' + src)
        return None
    # imported_object_paths mixes mesh/material/textures — pick by class
    chosen = None
    for cls in _CLASS_ORDER:
        for p in imported:
            a = unreal.load_asset(p.split('.')[0])
            if isinstance(a, cls):
                chosen = a
                break
        if chosen:
            break
    chosen = chosen or unreal.load_asset(imported[0].split('.')[0])
    log('  imported %s -> %s (%s)' %
        (os.path.basename(src), imported[0],
         type(chosen).__name__))
    return chosen


def import_dir(pattern_dir, exts, dest):
    out = {}
    names = set(os.listdir(pattern_dir))
    for f in sorted(names):
        base, ext = os.path.splitext(f)
        if ext.lower() not in exts:
            continue
        # prefer the Blender-converted .fbx over the source .glb
        # (Interchange rejects EXT_meshopt_compression / KHR quantization)
        if ext.lower() == '.glb' and (base + '.fbx') in names:
            continue
        a = import_file(os.path.join(pattern_dir, f), dest)
        if a:
            out[base] = a
    return out


def new_material(name, folder):
    path = folder + '/' + name
    if arl.does_asset_exist(path):
        mat = unreal.load_asset(path)
        unreal.MaterialEditingLibrary.delete_all_material_expressions(mat)
        return mat
    return tools.create_asset(name, folder, unreal.Material,
                              unreal.MaterialFactoryNew())


def tex_node(mat, asset, x, y, srgb=True):
    t = unreal.MaterialEditingLibrary.create_material_expression(
        mat, unreal.MaterialExpressionTextureSample, x, y)
    t.texture = asset
    if not srgb:
        t.set_editor_property('sampler_type',
                              unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
    return t


def const(mat, v, x, y):
    c = unreal.MaterialEditingLibrary.create_material_expression(
        mat, unreal.MaterialExpressionConstant, x, y)
    c.set_editor_property('r', v)
    return c


def build_road_material(folder, albedo):
    mat = new_material('M_Road', folder)
    mel = unreal.MaterialEditingLibrary
    t = tex_node(mat, albedo, -600, 0)
    mel.connect_material_property(t, 'RGB',
                                  unreal.MaterialProperty.MP_BASE_COLOR)
    r = const(mat, 0.32, -600, 200)          # wet asphalt
    mel.connect_material_property(r, '',
                                  unreal.MaterialProperty.MP_ROUGHNESS)
    s = const(mat, 0.55, -600, 340)
    mel.connect_material_property(s, '',
                                  unreal.MaterialProperty.MP_SPECULAR)
    mel.recompile_material(mat)
    return mat


def build_terrain_material(folder):
    mat = new_material('M_Terrain', folder)
    mel = unreal.MaterialEditingLibrary
    vc = mel.create_material_expression(
        mat, unreal.MaterialExpressionVertexColor, -700, 0)
    lerp = mel.create_material_expression(
        mat, unreal.MaterialExpressionLinearInterpolate, -450, 0)
    a = mel.create_material_expression(
        mat, unreal.MaterialExpressionConstant3Vector, -700, -140)
    b = mel.create_material_expression(
        mat, unreal.MaterialExpressionConstant3Vector, -700, 140)
    a.set_editor_property('constant', unreal.LinearColor(0.30, 0.26, 0.20, 1))
    b.set_editor_property('constant', unreal.LinearColor(0.14, 0.20, 0.10, 1))
    mel.connect_material_expressions(a, '', lerp, 'A')
    mel.connect_material_expressions(b, '', lerp, 'B')
    mel.connect_material_expressions(vc, 'R', lerp, 'Alpha')
    mel.connect_material_property(lerp, '',
                                  unreal.MaterialProperty.MP_BASE_COLOR)
    r = const(mat, 0.9, -400, 200)
    mel.connect_material_property(r, '',
                                  unreal.MaterialProperty.MP_ROUGHNESS)
    mel.recompile_material(mat)
    return mat


def spawn_static(mesh, loc, rot=unreal.Rotator(), name=''):
    a = lvl.spawn_actor_from_class(unreal.StaticMeshActor, loc, rot)
    a.get_component_by_class(
        unreal.StaticMeshComponent).set_static_mesh(mesh)
    if name:
        a.set_actor_label(name)
    return a


def enable_nanite(mesh):
    try:
        ns = mesh.get_editor_property('nanite_settings')
        ns.set_editor_property('enabled', True)
        mesh.set_editor_property('nanite_settings', ns)
    except Exception as e:
        log('  nanite skip %s: %s' % (mesh.get_name(), e))


def main():
    log('staging: ' + STAGING)
    mel_ok = True

    # ------------------------------------------------ 1 import
    log('phase 1: importing assets')
    tex = import_dir(os.path.join(STAGING, 'textures'),
                     ('.png', '.jpg', '.tga'), CONTENT + '/Textures')
    models = import_dir(os.path.join(STAGING, 'models'),
                        ('.fbx', '.glb'), CONTENT + '/Models')
    tiles = import_dir(STAGING, ('.glb',), CONTENT + '/Terrain')
    road_mesh = tiles.pop('road', None)
    tiles = {k: v for k, v in tiles.items() if k.startswith('terrain_tile')}
    log('  %d textures, %d models, %d terrain tiles' %
        (len(tex), len(models), len(tiles)))

    # DB4 split parts + full PBR material graph — reuse the proven pipeline
    # from cars/AstonDB4_Unreal_Environment (imports to /Game/DB4/*)
    db4_setup = os.path.join(unreal.Paths.project_dir(),
                             'Content', 'Python', 'setup_db4.py')
    if os.path.exists(db4_setup):
        try:
            exec(compile(open(db4_setup).read(), db4_setup, 'exec'), {})
            log('  setup_db4.py finished')
        except Exception as e:
            log('  !! setup_db4.py failed: %s' % e)

    for m in list(tiles.values()) + [road_mesh]:
        if m:
            enable_nanite(m)

    # ------------------------------------------------ 2 materials
    log('phase 2: materials')
    mats = {}
    try:
        alb = tex.get('road_albedo')
        if alb:
            mats['road'] = build_road_material(CONTENT + '/Materials', alb)
        mats['terrain'] = build_terrain_material(CONTENT + '/Materials')
        arl.save_loaded_asset(list(mats.values())[-1])
    except Exception as e:
        mel_ok = False
        log('  material build failed (imported defaults used): %s' % e)

    # ------------------------------------------------ 3 world geo
    log('phase 3: spawning world')
    lvl.new_level(LEVEL) if not arl.does_asset_exist(LEVEL) else \
        lvl.load_level(LEVEL)
    origin = unreal.Vector(0, 0, 0)
    for name, mesh in tiles.items():
        a = spawn_static(mesh, origin, name=name)
        if 'terrain' in mats:
            a.get_component_by_class(
                unreal.StaticMeshComponent).set_material(0, mats['terrain'])
    if road_mesh:
        a = spawn_static(road_mesh, origin, name='Road')
        if 'road' in mats:
            a.get_component_by_class(
                unreal.StaticMeshComponent).set_material(0, mats['road'])

    # ------------------------------------------------ 4 scatter
    log('phase 4: scatter (HISM)')
    sc = os.path.join(STAGING, 'scatter.csv')
    buckets = {}
    if os.path.exists(sc):
        for row in csv.DictReader(open(sc)):
            buckets.setdefault(row['type'], []).append(row)
        mesh_map = {
            'tree': models.get('birch') or models.get('tree_a')
                    or next(iter(models.values()), None),
            'rock': models.get('rocks') or models.get('kit_props'),
            'shrub': models.get('foliage') or models.get('tree_b'),
        }
        for kind, rows in buckets.items():
            mesh = mesh_map.get(kind)
            if not mesh:
                log('  no mesh for %s, skipped %d' % (kind, len(rows)))
                continue
            actor = lvl.spawn_actor_from_class(unreal.Actor, origin)
            actor.set_actor_label('Foliage_' + kind)
            hism = unreal.new_object(
                unreal.HierarchicalInstancedStaticMeshComponent,
                actor, kind + '_hism')
            # attach_to_component registers it — no register_component binding
            hism.attach_to_component(
                actor.root_component, '',
                unreal.AttachmentRule.KEEP_RELATIVE,
                unreal.AttachmentRule.KEEP_RELATIVE,
                unreal.AttachmentRule.KEEP_RELATIVE, False)
            hism.set_static_mesh(mesh if isinstance(mesh, unreal.StaticMesh)
                                 else mesh)
            for r in rows:
                s = float(r['scale'])
                t = unreal.Transform()
                t.rotation = unreal.Rotator(
                    0.0, float(r['yaw_deg']), 0.0).quaternion()
                t.translation = unreal.Vector(
                    float(r['ue_x']), float(r['ue_y']), float(r['ue_z']))
                t.scale3d = unreal.Vector(s, s, s)
                hism.add_instance(t, True)
            log('  %s: %d instances' % (kind, len(rows)))

    # ------------------------------------------------ 5 lighting
    log('phase 5: blue-hour lighting rig')
    sun = lvl.spawn_actor_from_class(unreal.DirectionalLight, origin)
    sun.set_actor_label('Sun_BlueHour')
    lc = sun.get_component_by_class(unreal.DirectionalLightComponent)
    lc.set_intensity(SUN_INTENSITY_LUX)
    lc.set_light_color(SUN_COLOR)
    lc.set_editor_property('atmosphere_sun_light', True)
    # UE light pitch = -sun_elevation: elev -0.8 -> pitch +0.8 (sun just
    # under the horizon; SkyAtmosphere keeps the sky lit for twilight)
    sun.set_actor_rotation(
        unreal.Rotator(-SUN_ELEV_DEG, SUN_AZIM_DEG, 0), False)

    # UE 5.8: atmosphere/clouds are components on plain actors
    def spawn_component_actor(comp_cls, label):
        a = lvl.spawn_actor_from_class(unreal.Actor, origin)
        c = unreal.new_object(comp_cls, a, label)
        c.attach_to_component(
            a.root_component, '',
            unreal.AttachmentRule.KEEP_RELATIVE,
            unreal.AttachmentRule.KEEP_RELATIVE,
            unreal.AttachmentRule.KEEP_RELATIVE, False)
        a.set_actor_label(label)
        return c

    spawn_component_actor(unreal.SkyAtmosphereComponent, 'SkyAtmosphere')
    sk = lvl.spawn_actor_from_class(unreal.SkyLight, origin)
    sk.get_component_by_class(unreal.SkyLightComponent
                              ).set_editor_property('real_time_capture', True)
    fog = lvl.spawn_actor_from_class(
        unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0))
    fc = fog.get_component_by_class(unreal.ExponentialHeightFogComponent)
    fc.set_editor_property('fog_density', FOG_DENSITY)
    for prop, val in (
            ('volumetric_fog', True),
            ('enable_volumetric_fog', True),
            ('fog_inscattering_color',
             unreal.LinearColor(0.19, 0.31, 0.40, 1)),
            ('directional_inscattering_color',
             unreal.LinearColor(0.19, 0.31, 0.40, 1))):
        try:
            fc.set_editor_property(prop, val)
        except Exception:
            pass
    spawn_component_actor(unreal.VolumetricCloudComponent, 'Clouds')
    pp = lvl.spawn_actor_from_class(unreal.PostProcessVolume, origin)
    pp.set_editor_property('unbound', True)
    try:
        settings = pp.get_editor_property('settings')
        settings.set_editor_property('override_auto_exposure_bias', True)
        settings.set_editor_property('auto_exposure_bias', EXPOSURE_BIAS)
        settings.set_editor_property('override_bloom_intensity', True)
        settings.set_editor_property('bloom_intensity', BLOOM)
        pp.set_editor_property('settings', settings)
    except Exception as e:
        log('  post-process settings skipped: %s' % e)

    # ------------------------------------------------ 6 route + car
    log('phase 6: spline + vehicle')
    sc_csv = os.path.join(STAGING, 'route_spline.csv')
    if os.path.exists(sc_csv):
        spline_actor = lvl.spawn_actor_from_class(unreal.Actor, origin)
        spline_actor.set_actor_label('RouteSpline')
        comp = unreal.new_object(unreal.SplineComponent, spline_actor,
                                 'route')
        comp.attach_to_component(
            spline_actor.root_component, '',
            unreal.AttachmentRule.KEEP_WORLD,
            unreal.AttachmentRule.KEEP_WORLD,
            unreal.AttachmentRule.KEEP_WORLD, False)
        pts = [unreal.Vector(float(r['ue_x']), float(r['ue_y']),
                             float(r['ue_z']))
               for r in csv.DictReader(open(sc_csv))]
        comp.set_spline_points(pts, unreal.SplineCoordinateSpace.WORLD,
                               False)
        comp.update_spline()
        log('  spline: %d points' % len(pts))

    # C++ environment actor (foliage/rails/ground math) if the module loaded
    env_cls = getattr(unreal, 'DB4Environment', None)
    if env_cls:
        env = lvl.spawn_actor_from_class(env_cls, origin)
        env.set_actor_label('BlueHour_Environment')
        try:
            env.set_editor_property('b_use_baked_world', True)
            log('  DB4Environment spawned (bUseBakedWorld=true)')
        except Exception:
            log('  DB4Environment spawned (bUseBakedWorld prop stale —'
                ' rebuild module; default is true anyway)')
    else:
        log('  AstonDB4 C++ module not loaded — foliage/rails/HUD inactive;'
            ' build BlueHourEditor and re-run phase 6')

    car = models.get('aston_db4')
    if car:
        a = spawn_static(car, unreal.Vector(0, 0, 300), name='DB4_Showcase')
        a.set_actor_label('DB4_Showcase')
        log('  DB4 showcase placed (player pawn comes from C++ GameMode)')

    # ------------------------------------------------ 7 save
    log('phase 7: saving')
    lvl.save_current_level()
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    log('DONE — level: ' + LEVEL)


try:
    main()
except Exception as e:
    import traceback
    traceback.print_exc()
    unreal.log_error('[BlueHour] build failed: %s' % e)
