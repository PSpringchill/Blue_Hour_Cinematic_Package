#include "DB4Environment.h"
#include "BHRoute.h"
#include "ProceduralMeshComponent.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/UObjectGlobals.h"
#include "Engine/World.h"

// Public API kept from the coastal-pass original:
//   RoadLocation(S) / RoadHeadingDegrees(S) — S = arclength in CM
//   GroundZ(X,Y) — world-space height via corridor heightfield
//   RoadY(S) — centerline Y at arclength S (compat shim)
namespace BH
{
    constexpr float RailInsetCm = 40.f;   // paint/rails this far inside edge
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
    for (UHierarchicalInstancedStaticMeshComponent* M : {TreeTrunks.Get(),PineCrowns.Get(),Rocks.Get(),RailBeams.Get(),RailPosts.Get(),Understory.Get()})
    {
        M->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        M->SetCastShadow(true);
    }
    Pavement->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
    Terrain->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
}

// ---- route-shimmed statics --------------------------------------------------
float ADB4Environment::RoadY(float S) { return BHRoute::PosCm(S).Y; }
float ADB4Environment::RoadZ(float S) { return BHRoute::PosCm(S).Z; }
FVector ADB4Environment::RoadLocation(float S) { return BHRoute::PosCm(S); }
float ADB4Environment::RoadHeadingDegrees(float S) { return BHRoute::HeadingDeg(S); }
float ADB4Environment::GroundZ(float X,float Y) { return BHRoute::WorldZcm(X,Y); }
// Drive surface incl. road deck (pawn + foliage placement use this).
static float SurfaceZ(float X, float Y) { return BHRoute::SurfaceZcm(X,Y); }
static float AbsLat(float X, float Y) { return BHRoute::AbsLateralCm(X,Y); }

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
    if (!bUseBakedWorld)
    {
        BuildMeshes();   // procedural fallback world
        BuildPaint();
    }
    else
    {
        Terrain->ClearAllMeshSections();
        Pavement->ClearAllMeshSections();
        RoadPaint->ClearAllMeshSections();
    }
    BuildFoliage();
}

void ADB4Environment::BuildMeshes()
{
    // Procedural fallback terrain when baked Nanite tiles aren't imported.
    Terrain->ClearAllMeshSections(); Pavement->ClearAllMeshSections(); RoadPaint->ClearAllMeshSections();
    const int32 NX=FMath::Clamp(TerrainResolutionX,32,420);
    const int32 NY=FMath::Clamp(TerrainResolutionY,32,340);
    const FBox2D Box=BHRoute::BoundsM();
    const float XMin=(Box.Min.Y-TerrainMarginCm*0.01f)*100.f;
    const float XMax=(Box.Max.Y+TerrainMarginCm*0.01f)*100.f;
    const float YMin=(Box.Min.X-TerrainMarginCm*0.01f)*100.f;
    const float YMax=(Box.Max.X+TerrainMarginCm*0.01f)*100.f;
    TArray<FVector> V,N; TArray<FVector2D> UV; TArray<int32> T;
    V.Reserve((NX+1)*(NY+1));N.Reserve((NX+1)*(NY+1));UV.Reserve((NX+1)*(NY+1));
    for(int32 I=0;I<=NX;I++) for(int32 J=0;J<=NY;J++)
    {
        const float X=FMath::Lerp(XMin,XMax,float(I)/NX);
        const float Y=FMath::Lerp(YMin,YMax,float(J)/NY);
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
    // Pavement ribbon along arclength
    AddStrip(Pavement,0,0.f,BHRoute::LengthCm()-400.f,-RoadWidthCm*.5f,RoadWidthCm*.5f,5.f,570.f,750.f,true);
    Pavement->SetMaterial(0,GetMaterial(TEXT("/Game/DB4/Materials/M_Asphalt.M_Asphalt"),FLinearColor(.085f,.091f,.105f)));
    AddStrip(Pavement,1,0.f,BHRoute::LengthCm()-400.f,-RoadWidthCm*.5f-190.f,-RoadWidthCm*.5f, 2.f,600.f,400.f,false);
    AddStrip(Pavement,2,0.f,BHRoute::LengthCm()-400.f,RoadWidthCm*.5f,RoadWidthCm*.5f+190.f,2.f,600.f,400.f,false);
    auto* Gravel=GetMaterial(TEXT("/Game/DB4/Materials/M_Gravel.M_Gravel"),FLinearColor(.37f,.31f,.25f));
    Pavement->SetMaterial(1,Gravel);Pavement->SetMaterial(2,Gravel);
}

void ADB4Environment::AddStrip(UProceduralMeshComponent* Mesh,int32 Section,float FromS,float ToS,float Left,float Right,float Lift,float TileX,float TileY,bool Collision)
{
    TArray<FVector> V,N; TArray<FVector2D> UV; TArray<int32> T;
    const int32 Count=FMath::CeilToInt((ToS-FromS)/400.f); // 4 m steps
    V.Reserve((Count+1)*2);N.Reserve((Count+1)*2);UV.Reserve((Count+1)*2);
    for(int32 I=0;I<=Count;I++)
    {
        const float S=FMath::Lerp(FromS,ToS,float(I)/Count);
        const FVector C=RoadLocation(S);
        const float hRad=FMath::DegreesToRadians(RoadHeadingDegrees(S));
        const FVector2D R(-FMath::Sin(hRad),FMath::Cos(hRad)); // ue right
        for(float Offset : {Left,Right})
        {
            const float latM=Offset*0.01f;
            const float Z=(BHRoute::ElevationAt(S*0.01f)+latM*BHRoute::BankAt(S*0.01f))*100.f;
            V.Add(FVector(C.X+R.X*Offset, C.Y+R.Y*Offset, Z+Lift));
            N.Add(FVector::UpVector);
            UV.Add(FVector2D((S-FromS)/TileX,Offset/TileY));
        }
    }
    for(int32 I=0;I<Count;I++)
    { int32 K=2*I; T.Add(K); T.Add(K+2); T.Add(K+1); T.Add(K+1); T.Add(K+2); T.Add(K+3); }
    Mesh->CreateMeshSection_LinearColor(Section,V,T,N,UV,{}, {},Collision);
}

void ADB4Environment::BuildPaint()
{
    TArray<FVector> V; TArray<int32> T; TArray<FVector2D> UV;
    auto Mark=[&](float S0,float S1,float OffsetCm,float WidthCm)
    {
        auto Pos=[&](float S,float SideOffsetCm)
        {
            const FVector C=RoadLocation(S);
            const float hRad=FMath::DegreesToRadians(RoadHeadingDegrees(S));
            const FVector2D R(-FMath::Sin(hRad),FMath::Cos(hRad));
            const float latM=SideOffsetCm*0.01f;
            const float Z=(BHRoute::ElevationAt(S*0.01f)+latM*BHRoute::BankAt(S*0.01f))*100.f;
            return FVector(C.X+R.X*SideOffsetCm,C.Y+R.Y*SideOffsetCm,Z+3.1f);
        };
        const int32 K=V.Num();
        V.Add(Pos(S0,OffsetCm-WidthCm*.5f));V.Add(Pos(S0,OffsetCm+WidthCm*.5f));
        V.Add(Pos(S1,OffsetCm-WidthCm*.5f));V.Add(Pos(S1,OffsetCm+WidthCm*.5f));
        UV.Add(FVector2D(0,0));UV.Add(FVector2D(1,0));UV.Add(FVector2D(0,1));UV.Add(FVector2D(1,1));
        T.Add(K);T.Add(K+2);T.Add(K+1);T.Add(K+1);T.Add(K+2);T.Add(K+3);
    };
    const float Len=BHRoute::LengthCm()-900.f;
    for(float S=300.f;S<Len;S+=1260.f) Mark(S,S+650.f,0.f,12.f);
    for(float S=300.f;S<Len;S+=550.f)
    {Mark(S,S+545.f,-RoadWidthCm*.5f+BH::RailInsetCm,9.f);Mark(S,S+545.f,RoadWidthCm*.5f-BH::RailInsetCm,9.f);}
    RoadPaint->CreateMeshSection_LinearColor(0,V,T,{},UV,{}, {}, false);
    RoadPaint->SetMaterial(0,GetMaterial(TEXT("/Game/DB4/Materials/M_Paint.M_Paint"),FLinearColor(.93f,.91f,.81f)));
}

void ADB4Environment::BuildFoliage()
{
    for(UHierarchicalInstancedStaticMeshComponent* C:{TreeTrunks.Get(),PineCrowns.Get(),Rocks.Get(),RailBeams.Get(),RailPosts.Get(),Understory.Get()}) C->ClearInstances();
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

    // Corridor scatter — same bands as ue/tools/export_route.py so both
    // frontends agree on where the forest sits.
    FRandomStream RNG(Seed);
    const float EndCm=BHRoute::LengthCm()-1500.f;
    auto Place=[&](float S,float latM)
    {
        const FVector C=RoadLocation(S);
        const float hRad=FMath::DegreesToRadians(RoadHeadingDegrees(S));
        const FVector2D R(-FMath::Sin(hRad),FMath::Cos(hRad));
        const float X=C.X+R.X*latM*100.f, Y=C.Y+R.Y*latM*100.f;
        return FVector(X,Y,SurfaceZ(X,Y));
    };
    for(float S=3000.f;S<EndCm;S+=RNG.FRandRange(400.f,700.f))
    {
        const float limM=BHRoute::TurnLimit(S*0.01f);
        // trees
        if(RNG.FRand()<0.75f)
        {
            const float side=RNG.FRand()<0.5f?-1.f:1.f;
            const float latM=side*RNG.FRandRange(11.f,FMath::Max(12.f,FMath::Min(limM-3.f,75.f)));
            const FVector At=Place(S,latM);
            float sc=RNG.FRandRange(.8f,1.5f);
            if(!RealTree) TreeTrunks->AddInstance(FTransform(FRotator(0,RNG.FRandRange(0,360),0),At+FVector(0,0,210.f*sc),FVector(.18f*sc,.18f*sc,4.2f*sc)));
            if(RealTree)
            {
                const float Fit=640.f/FMath::Max(RealTree->GetBounds().BoxExtent.Z*2.f,1.f);
                PineCrowns->AddInstance(FTransform(FRotator(0,RNG.FRandRange(0,360),0),At,FVector(Fit*sc)));
            }
            else for(int32 L=0;L<3;L++)
            {
                const float K=(1.f-.22f*L)*sc;
                PineCrowns->AddInstance(FTransform(FRotator(0,RNG.FRandRange(0,360),0),At+FVector(0,0,(335.f+155.f*L)*sc),FVector(2.2f*K,2.2f*K,3.1f*K)));
            }
        }
        if(RNG.FRand()<0.10f)
        {
            const float side=RNG.FRand()<0.5f?-1.f:1.f;
            const float latM=side*RNG.FRandRange(9.5f,FMath::Max(10.f,FMath::Min(limM-4.f,55.f)));
            const FVector At=Place(S,latM);
            float sc=RNG.FRandRange(.5f,2.2f);
            const float Fit=RealRock?110.f/FMath::Max(RealRock->GetBounds().BoxExtent.GetMax()*2.f,1.f):1.f;
            Rocks->AddInstance(FTransform(FRotator(RNG.FRandRange(-15,15),RNG.FRandRange(0,180),0),At+FVector(0,0,RealRock?-30.f*sc:55.f*sc),FVector(1.5f*sc,.9f*sc,.85f*sc)*Fit));
        }
        for(int32 K=0;K<3;K++) if(RNG.FRand()<0.8f)
        {
            const float side=RNG.FRand()<0.5f?-1.f:1.f;
            const float latM=side*RNG.FRandRange(8.8f,FMath::Max(9.f,FMath::Min(limM-2.f,26.f)));
            const FVector At=Place(S,latM);
            float sc=RNG.FRandRange(.6f,1.4f);
            const float Fit=RealShrub?110.f/FMath::Max(RealShrub->GetBounds().BoxExtent.GetMax()*2.f,1.f):1.f;
            Understory->AddInstance(FTransform(FRotator(0,RNG.FRandRange(0,360),0),At+FVector(0,0,RealShrub?0.f:20.f*sc),FVector(1.4f*sc,1.3f*sc,.5f*sc)*Fit));
        }
    }
    // guardrails every ~10.5 m on both edges of the pavement
    for(float S=300.f;S<EndCm-1200.f;S+=1050.f)
    {
        const float hDeg=RoadHeadingDegrees(S);
        for(float Sign : {-1.f,1.f})
        {
            const float offCm=Sign*(RoadWidthCm*.5f+280.f);
            const FVector At=Place(S,offCm*0.01f);
            RailBeams->AddInstance(FTransform(FRotator(0,hDeg,0),At+FVector(0,0,65),FVector(10.7f,.15f,.30f)));
            RailPosts->AddInstance(FTransform(FRotator(0,hDeg,0),At+FVector(0,0,35),FVector(.16f,.16f,.9f)));
        }
    }
}
