using UnrealBuildTool;
using System.Collections.Generic;
public class AstonDB4Target : TargetRules
{
    public AstonDB4Target(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
        ExtraModuleNames.Add("AstonDB4");
    }
}
