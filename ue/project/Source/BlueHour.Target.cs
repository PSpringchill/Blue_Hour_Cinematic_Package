using UnrealBuildTool;
using System.Collections.Generic;
public class BlueHourTarget : TargetRules
{
    public BlueHourTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("AstonDB4");
    }
}
