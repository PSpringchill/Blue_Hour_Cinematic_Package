using UnrealBuildTool;
public class AstonDB4 : ModuleRules
{
    public AstonDB4(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] {
            "Core", "CoreUObject", "Engine", "InputCore", "ProceduralMeshComponent",
            "DB4MusicIsland"
        });
    }
}
