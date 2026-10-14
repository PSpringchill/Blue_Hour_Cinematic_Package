#include "DB4Environment.h"
#include "ProceduralMeshComponent.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/UObjectGlobals.h"
#include "Engine/World.h"

namespace DB4Landscape
{
    constexpr float XMin = -8500.f;
    constexpr float XMax = 134000.f;
    constexpr float YMin = -45000.f;
    constexpr float YMax = 45000.f;
    float Ease(float X) { X = FMath::Clamp(X,0.f,1.f); return X*X*(3.f-2.f*X); }
    FVector2D Side(float X)
    {
        const float Derivative = (ADB4Environment::RoadY(X+80.f)-ADB4Environment::RoadY(X-80.f))/160.f;
        return FVector2D(-Derivative, 1.f).GetSafeNormal();
    }
    void AddQuad(TArray<FVector>& P, TArray<int32>& Id, TArray<FVector2D>& UV,
                 const FVector& A,const FVector& B,const FVector& C,const FVector& D)
    {
        int32 K=P.Num(); P.Add(A);P.Add(B);P.Add(C);P.Add(D);
        UV.Add(FVector2D(0,0));UV.Add(FVector2D(1,0));UV.Add(FVector2D(0,1));UV.Add(FVector2D(1,1));
        Id.Add(K); Id.Add(K+2); Id.Add(K+1); Id.Add(K+1); Id.Add(K+2); Id.Add(K+3);
    }
}

ADB4Environment::ADB4Environment()
{
    PrimaryActorTick.bCanEverTick = false;
    USceneComponent* Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
    SetRootComponent(Root);
    Terrain = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("ScenicTerrain")); Terrain->SetupAttachment(Root);
    Pavement = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("CurvedRoad")); Pavement->SetupAttachment(Root);
    RoadPaint = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("RoadMarkings")); RoadPaint->SetupAttachment(Root);
    TreeTrunks=CreateDefaultSubobject<UHierarchicalInstancedStaticMeshComponent>(TEXT("InstancedTrunks"));TreeTrunks->SetupAttachment(Root);
    PineCrowns=CreateDefaultSubobject<UHierarchicalInstancedStaticMeshComponent>(TEXT("InstancedConiferCanopies"));PineCrowns->SetupAttachment(Root);
    Rocks=CreateDefaultSubobject<UHierarchicalInstancedStaticMeshComponent>(TEXT("InstancedRocks"));Rocks->SetupAttachment(Root);
    RailBeams=CreateDefaultSubobject<UHierarchicalInstancedStaticMeshComponent>(TEXT("RoadsideGuardrails"));RailBeams->SetupAttachment(Root);
    RailPosts=CreateDefaultSubobject<UHierarchicalInstancedStaticMeshComponent>(TEXT("GuardrailPosts"));RailPosts->SetupAttachment(Root);
    Understory=CreateDefaultSubobject<UHierarchicalInstancedStaticMeshComponent>(TEXT("GroundCover"));Understory->SetupAttachment(Root);
    for (auto* M : {TreeTrunks,PineCrowns,Rocks,RailBeams,RailPosts,Understory})
    {
        M->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        M->SetCastShadow(true);
    }
    Pavement->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
    Terrain->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
}

float ADB4Environment::RoadY(float X)
{
    return 4200.f*FMath::Sin(X/13000.f)+1700.f*FMath::Sin(X/5400.f + 0.28f);
}
float ADB4Environment::RoadZ(float X)
{
    return 90.f + 160.f*FMath::Sin(X/14500.f) + 54.f*FMath::Sin(X/5700.f);
}
float ADB4Environment::GroundZ(float X,float Y)
{
    const float Dist=FMath::Abs(Y-RoadY(X));
    const float Blend=DB4Landscape::Ease((Dist-720.f)/2350.f);
    const float NoiseA=FMath::PerlinNoise2D(FVector2D(X*.00012f,Y*.00010f));
    const float NoiseB=FMath::PerlinNoise2D(FVector2D(X*.00051f,Y*.00048f));
    const float Ridge=FMath::Pow(FMath::Clamp((Dist-1200.f)/11500.f,0.f,2.7f),1.4f);
    const float H=RoadZ(X)-26.f+330.f*NoiseA+88.f*NoiseB+1450.f*Ridge;
    return FMath::Lerp(RoadZ(X)-29.f,H,Blend);
}
FVector ADB4Environment::RoadLocation(float X) { return FVector(X,RoadY(X),RoadZ(X)); }
float ADB4Environment::RoadHeadingDegrees(float X)
{
    return FMath::RadiansToDegrees(FMath::Atan2(RoadY(X+100.f)-RoadY(X-100.f),200.f));
}

UMaterialInterface* ADB4Environment::GetMaterial(const TCHAR* Path,const FLinearColor& Color) const
{
    if (UMaterialInterface* Imported=LoadObject<UMaterialInterface>(nullptr,Path)) return Imported;
    UMaterialInterface* Fallback=LoadObject<UMaterialInterface>(nullptr,TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
    if (!Fallback) return nullptr;
    UMaterialInstanceDynamic* MID=UMaterialInstanceDynamic::Create(Fallback,const_cast<ADB4Environment*>(this));
    MID->SetVectorParameterValue(TEXT("Color"),Color);
    return MID;
}

void ADB4Environment::OnConstruction(const FTransform& Transform)
{
    Super::OnConstruction(Transform);
    if(bGenerateInEditor && !GetWorld()->IsGameWorld()) Rebuild();
}
void ADB4Environment::BeginPlay()
{
    Super::BeginPlay();
    Rebuild();
}
void ADB4Environment::Rebuild()
{
    BuildMeshes();
    BuildFoliage();
}

void ADB4Environment::BuildMeshes()
{
    Terrain->ClearAllMeshSections(); Pavement->ClearAllMeshSections(); RoadPaint->ClearAllMeshSections();
    const int32 NX=FMath::Clamp(TerrainResolutionX,32,420);
    const int32 NY=FMath::Clamp(TerrainResolutionY,32,340);
    TArray<FVector> V,N; TArray<FVector2D> UV; TArray<int32> T;
    V.Reserve((NX+1)*(NY+1));N.Reserve((NX+1)*(NY+1));UV.Reserve((NX+1)*(NY+1));
    for(int32 I=0;I<=NX;I++) for(int32 J=0;J<=NY;J++)
    {
        const float X=FMath::Lerp(DB4Landscape::XMin,DB4Landscape::XMax,float(I)/NX);
        const float Y=FMath::Lerp(DB4Landscape::YMin,DB4Landscape::YMax,float(J)/NY);
        V.Add(FVector(X,Y,GroundZ(X,Y)));
        const float Dx=(GroundZ(X+100,Y)-GroundZ(X-100,Y))/200.f;
        const float Dy=(GroundZ(X,Y+100)-GroundZ(X,Y-100))/200.f;
        N.Add(FVector(-Dx,-Dy,1).GetSafeNormal()); UV.Add(FVector2D(X/450.f,Y/450.f));
    }
    for(int32 I=0;I<NX;I++) for(int32 J=0;J<NY;J++)
    {
        const int32 A=I*(NY+1)+J, B=A+NY+1;
        T.Add(A); T.Add(B); T.Add(A+1); T.Add(A+1); T.Add(B); T.Add(B+1);
    }
    Terrain->CreateMeshSection_LinearColor(0,V,T,N,UV,{}, {}, true);
    Terrain->SetMaterial(0,GetMaterial(TEXT("/Game/DB4/Materials/M_Ground.M_Ground"),FLinearColor(.17f,.24f,.12f)));
    AddStrip(Pavement,0,DB4Landscape::XMin+100.f,DB4Landscape::XMax-500.f,-RoadWidthCm*.5f,RoadWidthCm*.5f,0.f,570.f,750.f,true);
    Pavement->SetMaterial(0,GetMaterial(TEXT("/Game/DB4/Materials/M_Asphalt.M_Asphalt"),FLinearColor(.085f,.091f,.105f)));
    AddStrip(Pavement,1,DB4Landscape::XMin+100.f,DB4Landscape::XMax-500.f,-RoadWidthCm*.5f-190.f,-RoadWidthCm*.5f, -3.f,600.f,400.f,false);
    AddStrip(Pavement,2,DB4Landscape::XMin+100.f,DB4Landscape::XMax-500.f,RoadWidthCm*.5f,RoadWidthCm*.5f+190.f,-3.f,600.f,400.f,false);
    auto* Gravel=GetMaterial(TEXT("/Game/DB4/Materials/M_Gravel.M_Gravel"),FLinearColor(.37f,.31f,.25f));
    Pavement->SetMaterial(1,Gravel);Pavement->SetMaterial(2,Gravel);
    BuildPaint();
}

void ADB4Environment::AddStrip(UProceduralMeshComponent* Mesh,int32 Section,float From,float To,float Left,float Right,float Lift,float TileX,float TileY,bool Collision)
{
    TArray<FVector> V,N; TArray<FVector2D> UV; TArray<int32> T;
    const int32 Count=FMath::CeilToInt((To-From)/185.f);
    V.Reserve((Count+1)*2);N.Reserve((Count+1)*2);UV.Reserve((Count+1)*2);
    for(int32 I=0;I<=Count;I++)
    {
        const float X=FMath::Lerp(From,To,float(I)/Count);FVector2D S=DB4Landscape::Side(X);
        const FVector C=RoadLocation(X);
        for(float Offset : {Left,Right})
        {
            V.Add(C+FVector(S.X*Offset,S.Y*Offset,Lift));N.Add(FVector::UpVector);
            UV.Add(FVector2D((X-From)/TileX,Offset/TileY));
        }
    }
    for(int32 I=0;I<Count;I++)
    { int32 K=2*I; T.Add(K); T.Add(K+2); T.Add(K+1); T.Add(K+1); T.Add(K+2); T.Add(K+3); }
    Mesh->CreateMeshSection_LinearColor(Section,V,T,N,UV,{}, {},Collision);
}

void ADB4Environment::BuildPaint()
{
    TArray<FVector> V; TArray<int32> T; TArray<FVector2D> UV;
    auto Mark=[&](float X0,float X1,float Offset,float Width)
    {
        auto Pos=[&](float X,float SideOffset)
        {
            const FVector2D S=DB4Landscape::Side(X);FVector C=RoadLocation(X);
            return C+FVector(S.X*SideOffset,S.Y*SideOffset,3.1f);
        };
        DB4Landscape::AddQuad(V,T,UV,Pos(X0,Offset-Width*.5f),Pos(X0,Offset+Width*.5f),
                              Pos(X1,Offset-Width*.5f),Pos(X1,Offset+Width*.5f));
    };
    for(float X=DB4Landscape::XMin+300.f;X<DB4Landscape::XMax-900.f;X+=1260.f) Mark(X,X+650.f,0.f,12.f);
    for(float X=DB4Landscape::XMin+300.f;X<DB4Landscape::XMax-900.f;X+=550.f)
    {Mark(X,X+545.f,-RoadWidthCm*.5f+40.f,9.f);Mark(X,X+545.f,RoadWidthCm*.5f-40.f,9.f);}
    RoadPaint->CreateMeshSection_LinearColor(0,V,T,{},UV,{}, {}, false);
    RoadPaint->SetMaterial(0,GetMaterial(TEXT("/Game/DB4/Materials/M_Paint.M_Paint"),FLinearColor(.93f,.91f,.81f)));
}

void ADB4Environment::BuildFoliage()
{
    for(auto* C:{TreeTrunks,PineCrowns,Rocks,RailBeams,RailPosts,Understory}) C->ClearInstances();
    UStaticMesh* Cube=LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Cube.Cube"));
    UStaticMesh* Cylinder=LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    UStaticMesh* Sphere=LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    UStaticMesh* Cone=LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Cone.Cone"));
    UStaticMesh* RealTree=PremiumTree.LoadSynchronous();
    UStaticMesh* RealRock=PremiumRock.LoadSynchronous();
    UStaticMesh* RealShrub=PremiumShrub.LoadSynchronous();
    TreeTrunks->SetStaticMesh(RealTree?nullptr:(Cylinder ? Cylinder : Cube));
    PineCrowns->SetStaticMesh(RealTree?RealTree:(Cone ? Cone : Sphere));
    Rocks->SetStaticMesh(RealRock?RealRock:Sphere);
    Understory->SetStaticMesh(RealShrub?RealShrub:Sphere);
    RailBeams->SetStaticMesh(Cube);RailPosts->SetStaticMesh(Cube);
    TreeTrunks->SetMaterial(0,GetMaterial(TEXT("/Game/DB4/Materials/M_Bark.M_Bark"),FLinearColor(.23f,.15f,.1f)));
    if(!RealTree) PineCrowns->SetMaterial(0,GetMaterial(TEXT("/Game/DB4/Materials/M_Foliage.M_Foliage"),FLinearColor(.05f,.14f,.075f)));
    if(!RealRock) Rocks->SetMaterial(0,GetMaterial(TEXT("/Game/DB4/Materials/M_Stone.M_Stone"),FLinearColor(.29f,.30f,.28f)));
    if(!RealShrub) Understory->SetMaterial(0,GetMaterial(TEXT("/Game/DB4/Materials/M_Foliage.M_Foliage"),FLinearColor(.05f,.14f,.075f)));
    auto* Metal=GetMaterial(TEXT("/Game/DB4/Materials/M_BrushedMetal.M_BrushedMetal"),FLinearColor(.44f,.48f,.49f));
    RailBeams->SetMaterial(0,Metal); RailPosts->SetMaterial(0,Metal);
    FRandomStream RNG(Seed);
    for(int32 I=0;I<TreeCount;I++)
    {
        const float X=RNG.FRandRange(DB4Landscape::XMin+1200.f,DB4Landscape::XMax-1000.f);
        const float Y=RNG.FRandRange(-35500.f,35500.f);
        if(FMath::Abs(Y-RoadY(X)) < 2100.f) continue;
        const float H=GroundZ(X,Y);float S=RNG.FRandRange(.75f,2.1f);
        if(!RealTree) TreeTrunks->AddInstance(FTransform(FRotator(0,RNG.FRandRange(0,360),0),FVector(X,Y,H+210.f*S),FVector(.18f*S,.18f*S,4.2f*S)));
        if(RealTree)
        {
            const float MeshHeight=FMath::Max(RealTree->GetBounds().BoxExtent.Z*2.f,1.f);
            const float Fit=640.f/MeshHeight;
            PineCrowns->AddInstance(FTransform(FRotator(0,RNG.FRandRange(0,360),0),FVector(X,Y,H),FVector(Fit*S)));
        }
        else for(int32 Layer=0;Layer<3;Layer++)
        {
            const float Scale=(1.f-.22f*Layer)*S;
            const float Z=H+(335.f+155.f*Layer)*S;
            // Cone primitive when present; sphere fallback still preserves instanced canopy silhouette.
            PineCrowns->AddInstance(FTransform(FRotator(0,RNG.FRandRange(0,360),0),FVector(X,Y,Z),FVector(2.2f*Scale,2.2f*Scale,3.1f*Scale)));
        }
    }
    for(int32 I=0;I<250;I++)
    {
        float X=RNG.FRandRange(DB4Landscape::XMin+100.f,DB4Landscape::XMax-100.f);
        float Y=RNG.FRandRange(-38000.f,38000.f);
        if(FMath::Abs(Y-RoadY(X))<1100.f) continue;
        float S=RNG.FRandRange(.4f,2.7f);float H=GroundZ(X,Y);
        const float RockSize=RealRock ? FMath::Max(RealRock->GetBounds().BoxExtent.GetMax()*2.f,1.f):100.f;
        const float RockFit=RealRock ? 110.f/RockSize : 1.f;
        Rocks->AddInstance(FTransform(FRotator(RNG.FRandRange(-15,15),RNG.FRandRange(0,180),0),FVector(X,Y,H+(RealRock?0.f:55.f*S)),FVector(1.5f*S,.9f*S,.85f*S)*RockFit));
    }
    for(int32 I=0;I<1250;I++)
    {
        float X=RNG.FRandRange(DB4Landscape::XMin+100.f,DB4Landscape::XMax-100.f);
        float Y=RNG.FRandRange(-35000.f,35000.f);
        if(FMath::Abs(Y-RoadY(X))<850.f) continue;
        float S=RNG.FRandRange(.15f,.46f);float H=GroundZ(X,Y);
        const float ShrubFit=RealShrub ? 110.f/FMath::Max(RealShrub->GetBounds().BoxExtent.GetMax()*2.f,1.f):1.f;
        Understory->AddInstance(FTransform(FRotator(0,RNG.FRandRange(0,360),0),FVector(X,Y,H+(RealShrub?0.f:20.f*S)),FVector(1.4f*S,1.3f*S,.5f*S)*ShrubFit));
    }
    for(float X=DB4Landscape::XMin+300.f;X<DB4Landscape::XMax-1500.f;X+=1050.f)
    {
        const FVector2D Side=DB4Landscape::Side(X);
        const float Y=RoadY(X)+RoadWidthCm*.5f+280.f;
        const FVector At(X+Side.X*(RoadWidthCm*.5f+280.f),RoadY(X)+Side.Y*(RoadWidthCm*.5f+280.f),RoadZ(X));
        const float Angle=RoadHeadingDegrees(X);
        RailBeams->AddInstance(FTransform(FRotator(0,Angle,0),At+FVector(0,0,65),FVector(10.7f,.15f,.30f)));
        RailPosts->AddInstance(FTransform(FRotator(0,Angle,0),At+FVector(0,0,35),FVector(.16f,.16f,.9f)));
    }
}
