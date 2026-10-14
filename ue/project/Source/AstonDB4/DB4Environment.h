#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DB4Environment.generated.h"

class UProceduralMeshComponent;
class UHierarchicalInstancedStaticMeshComponent;
class UMaterialInterface;
class UStaticMesh;

UCLASS(Blueprintable)
class ASTONDB4_API ADB4Environment : public AActor
{
    GENERATED_BODY()
public:
    ADB4Environment();
    virtual void OnConstruction(const FTransform& Transform) override;
    virtual void BeginPlay() override;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Landscape")
    int32 TerrainResolutionX = 190;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Landscape")
    int32 TerrainResolutionY = 140;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Landscape")
    int32 Seed = 4817;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Landscape")
    int32 TreeCount = 620;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Landscape")
    float RoadWidthCm = 1440.f;   // matches JS roadHalfWidth 7.2 m
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Landscape")
    bool bGenerateInEditor = true;
    // When true the visual world comes from imported Nanite tiles + road.glb
    // (ue_setup.py); this actor only provides GroundZ math, foliage, rails.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Landscape")
    bool bUseBakedWorld = true;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Landscape")
    float TerrainMarginCm = 45000.f;

    static float RoadY(float X);
    static float RoadZ(float X);
    static float GroundZ(float X, float Y);
    static FVector RoadLocation(float X);
    static float RoadHeadingDegrees(float X);

    // Replace the procedural placeholders with licensed Fab/Megascans meshes.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Photorealism | Fab Overrides")
    TSoftObjectPtr<UStaticMesh> PremiumTree;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Photorealism | Fab Overrides")
    TSoftObjectPtr<UStaticMesh> PremiumRock;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Photorealism | Fab Overrides")
    TSoftObjectPtr<UStaticMesh> PremiumShrub;

    UFUNCTION(CallInEditor, Category="Landscape")
    void Rebuild();
private:
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UProceduralMeshComponent> Terrain;
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UProceduralMeshComponent> Pavement;
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UProceduralMeshComponent> RoadPaint;
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UHierarchicalInstancedStaticMeshComponent> TreeTrunks;
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UHierarchicalInstancedStaticMeshComponent> PineCrowns;
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UHierarchicalInstancedStaticMeshComponent> Rocks;
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UHierarchicalInstancedStaticMeshComponent> RailBeams;
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UHierarchicalInstancedStaticMeshComponent> RailPosts;
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UHierarchicalInstancedStaticMeshComponent> Understory;
    void BuildMeshes();
    void BuildFoliage();
    void AddStrip(UProceduralMeshComponent* Mesh, int32 Section, float From, float To, float Left, float Right, float Lift, float TileX, float TileY, bool Collision);
    void BuildPaint();
    UMaterialInterface* GetMaterial(const TCHAR* Path, const FLinearColor& Color) const;
};
