using UnrealBuildTool;
using System.Collections.Generic;
public class BlueHourEditorTarget : TargetRules
{
    public BlueHourEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("AstonDB4");
    }
}
