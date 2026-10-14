using UnrealBuildTool;
using System.Collections.Generic;
public class AstonDB4EditorTarget : TargetRules
{
    public AstonDB4EditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
        ExtraModuleNames.Add("AstonDB4");
    }
}
