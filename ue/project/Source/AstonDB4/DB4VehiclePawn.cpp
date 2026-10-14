#include "DB4VehiclePawn.h"
#include "DB4Environment.h"
#include "BHRoute.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Camera/CameraComponent.h"
#include "Components/InputComponent.h"
#include "Components/SpotLightComponent.h"
#include "ProceduralMeshComponent.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/UObjectGlobals.h"

namespace DB4Car
{
    UStaticMesh* Shape(const TCHAR* Path) {return LoadObject<UStaticMesh>(nullptr,Path);}
    UMaterialInterface* Material(const TCHAR* Path,const FLinearColor& Color,UObject* Owner)
    {
        if(UMaterialInterface* M=LoadObject<UMaterialInterface>(nullptr,Path))return M;
        auto* Base=LoadObject<UMaterialInterface>(nullptr,TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
        if(!Base) return nullptr;
        auto* MID=UMaterialInstanceDynamic::Create(Base,Owner); MID->SetVectorParameterValue(TEXT("Color"),Color);return MID;
    }
    void SetupCube(UStaticMeshComponent* Comp, const FVector& Location, const FVector& SizeCm, UMaterialInterface* Material)
    {
        Comp->SetStaticMesh(Shape(TEXT("/Engine/BasicShapes/Cube.Cube")));
        Comp->SetRelativeLocation(Location);Comp->SetRelativeScale3D(SizeCm/100.f);
        Comp->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Comp->SetCastShadow(true);
        if(Material)Comp->SetMaterial(0,Material);
    }
}

ADB4VehiclePawn::ADB4VehiclePawn()
{
    PrimaryActorTick.bCanEverTick=true; AutoPossessPlayer=EAutoReceiveInput::Player0;
    Chassis=CreateDefaultSubobject<USceneComponent>(TEXT("VehicleRoot"));SetRootComponent(Chassis);
    Visual=CreateDefaultSubobject<USceneComponent>(TEXT("AnimatedBodyPivot"));Visual->SetupAttachment(Chassis);
    CarBody=CreateDefaultSubobject<UStaticMeshComponent>(TEXT("DB4Body"));CarBody->SetupAttachment(Visual);CarBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    FrontLeftPivot=CreateDefaultSubobject<USceneComponent>(TEXT("FrontLeftSteering"));FrontLeftPivot->SetupAttachment(Visual);
    FrontRightPivot=CreateDefaultSubobject<USceneComponent>(TEXT("FrontRightSteering"));FrontRightPivot->SetupAttachment(Visual);
    RearLeftPivot=CreateDefaultSubobject<USceneComponent>(TEXT("RearLeftAxle"));RearLeftPivot->SetupAttachment(Visual);
    RearRightPivot=CreateDefaultSubobject<USceneComponent>(TEXT("RearRightAxle"));RearRightPivot->SetupAttachment(Visual);
    FrontLeftMesh=CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FrontLeftTire"));FrontLeftMesh->SetupAttachment(FrontLeftPivot);
    FrontRightMesh=CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FrontRightTire"));FrontRightMesh->SetupAttachment(FrontRightPivot);
    RearLeftMesh=CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RearLeftTire"));RearLeftMesh->SetupAttachment(RearLeftPivot);
    RearRightMesh=CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RearRightTire"));RearRightMesh->SetupAttachment(RearRightPivot);
    for(UStaticMeshComponent* W:{FrontLeftMesh.Get(),FrontRightMesh.Get(),RearLeftMesh.Get(),RearRightMesh.Get()}) W->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    FrontLeftPivot->SetRelativeLocation(FVector(126.f,-60.f,35.f));
    FrontRightPivot->SetRelativeLocation(FVector(126.f, 60.f,35.f));
    RearLeftPivot->SetRelativeLocation(FVector(-120.f,-60.f,35.f));
    RearRightPivot->SetRelativeLocation(FVector(-120.f,60.f,35.f));

    Dashboard=CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeatherDashboard"));Dashboard->SetupAttachment(Visual);
    CenterTunnel=CreateDefaultSubobject<UStaticMeshComponent>(TEXT("CenterConsole"));CenterTunnel->SetupAttachment(Visual);
    SteeringColumn=CreateDefaultSubobject<USceneComponent>(TEXT("SteeringAnimationPivot"));SteeringColumn->SetupAttachment(Visual);
    SteeringColumn->SetRelativeLocation(FVector(31.f,-40.f,103.f));
    SteeringColumn->SetRelativeRotation(FRotator(0,0,0));
    SteeringRim=CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("WoodRim"));SteeringRim->SetupAttachment(SteeringColumn);
    SteeringHub=CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Hub"));SteeringHub->SetupAttachment(SteeringColumn);

    DriverCamera=CreateDefaultSubobject<UCameraComponent>(TEXT("DriverPOV"));DriverCamera->SetupAttachment(Visual);
    DriverCamera->SetRelativeLocation(FVector(-50.f,-43.f,DriverHeightCm));
    DriverCamera->FieldOfView=82.f;
    ChaseCamera=CreateDefaultSubobject<UCameraComponent>(TEXT("ChasePOV"));ChaseCamera->SetupAttachment(Chassis);
    ChaseCamera->SetRelativeLocation(FVector(-610.f,0.f,220.f));ChaseCamera->FieldOfView=77.f;
    OrbitCamera=CreateDefaultSubobject<UCameraComponent>(TEXT("OrbitPOV"));OrbitCamera->SetupAttachment(Chassis);
    OrbitCamera->SetRelativeLocation(FVector(-520.f,-580.f,255.f));OrbitCamera->FieldOfView=68.f;
    HeadlightL=CreateDefaultSubobject<USpotLightComponent>(TEXT("LeftBeam"));HeadlightL->SetupAttachment(Visual);
    HeadlightR=CreateDefaultSubobject<USpotLightComponent>(TEXT("RightBeam"));HeadlightR->SetupAttachment(Visual);
    for(USpotLightComponent* H:{HeadlightL.Get(),HeadlightR.Get()})
    {
        H->SetIntensity(80000.f);H->SetAttenuationRadius(4500.f);H->SetInnerConeAngle(15.f);H->SetOuterConeAngle(31.f);
        H->SetLightColor(FLinearColor(1.0f,.87f,.68f));H->SetVisibility(false);
    }
    HeadlightL->SetRelativeLocation(FVector(198.f,-57.f,75.f));
    HeadlightR->SetRelativeLocation(FVector(198.f,57.f,75.f));
}

void ADB4VehiclePawn::BeginPlay()
{
    Super::BeginPlay();
    PC=Cast<APlayerController>(GetController());
    LoadCarMeshes();BuildSteeringRing();
    auto* Wood=DB4Car::Material(TEXT("/Game/DB4/Materials/M_Wood.M_Wood"),FLinearColor(.24f,.094f,.036f),this);
    auto* Leather=DB4Car::Material(TEXT("/Game/DB4/Materials/M_Leather.M_Leather"),FLinearColor(.045f,.037f,.032f),this);
    auto* Metal=DB4Car::Material(TEXT("/Game/DB4/Materials/M_BrushedMetal.M_BrushedMetal"),FLinearColor(.43f,.47f,.48f),this);
    DB4Car::SetupCube(Dashboard,FVector(42.f,0.f,88.f),FVector(54.f,144.f,24.f),Leather);
    DB4Car::SetupCube(CenterTunnel,FVector(-18.f,0.f,48.f),FVector(90.f,35.f,38.f),Leather);
    DB4Car::SetupCube(SteeringHub,FVector(0,0,0),FVector(6.f,10.f,10.f),Metal);
    SteeringRim->SetMaterial(0,Wood);
    DriverCamera->SetActive(true); ChaseCamera->SetActive(false);OrbitCamera->SetActive(false);
    ResetCar();
}

void ADB4VehiclePawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);
    // Poll input during Tick: W/A/S/D, arrows, C, R, L, mouse look.
    // This makes the project usable before creating Enhanced Input assets.
}

void ADB4VehiclePawn::SetCarMesh(UStaticMeshComponent* Comp,const TCHAR* Path,const FVector& AnchorCm,bool bWheel)
{
    if(UStaticMesh* Mesh=LoadObject<UStaticMesh>(nullptr,Path))
    {
        Comp->SetStaticMesh(Mesh);
        const FBoxSphereBounds B=Mesh->GetBounds();
        const float Length=B.BoxExtent.X*2.f;
        const float Target=bWheel?70.6f:435.f;
        const float Scale=Length>SMALL_NUMBER?Target/Length:1.f;
        Comp->SetRelativeScale3D(FVector(Scale));
        // Raw source meshes contain vertex coordinates in the full car frame.
        // Center the mesh at its component's axle (or at vehicle origin for body).
        const FVector LocalOffset=bWheel?FVector::ZeroVector:FVector(0.f,0.f,70.f);
        Comp->SetRelativeLocation(-B.Origin*Scale+LocalOffset);
        UE_LOG(LogTemp,Display,TEXT("DB4 loaded: %s, original extent %.1f, scale %.3f"),Path,Length,Scale);
    }
    else
    {
        UE_LOG(LogTemp,Warning,TEXT("DB4 asset missing: %s (placeholder enabled)"),Path);
        Comp->SetStaticMesh(DB4Car::Shape(TEXT("/Engine/BasicShapes/Sphere.Sphere")));
        Comp->SetRelativeScale3D(bWheel?FVector(.36f,.19f,.36f):FVector(2.18f,.84f,.48f));
        Comp->SetRelativeLocation(bWheel?FVector::ZeroVector:FVector(0,0,90));
        Comp->SetMaterial(0,DB4Car::Material(TEXT("/Game/DB4/Materials/M_PaintCar.M_PaintCar"),FLinearColor(.045f,.21f,.11f),this));
    }
}
void ADB4VehiclePawn::LoadCarMeshes()
{
    SetCarMesh(CarBody,TEXT("/Game/DB4/Car/CAR_BODY.CAR_BODY"),FVector::ZeroVector,false);
    SetCarMesh(FrontLeftMesh,TEXT("/Game/DB4/Car/FL_WHEEL.FL_WHEEL"),FVector(126,-60,35),true);
    SetCarMesh(FrontRightMesh,TEXT("/Game/DB4/Car/FR_WHEEL.FR_WHEEL"),FVector(126,60,35),true);
    SetCarMesh(RearLeftMesh,TEXT("/Game/DB4/Car/RL_WHEEL.RL_WHEEL"),FVector(-120,-60,35),true);
    SetCarMesh(RearRightMesh,TEXT("/Game/DB4/Car/RR_WHEEL.RR_WHEEL"),FVector(-120,60,35),true);
}
void ADB4VehiclePawn::BuildSteeringRing()
{
    TArray<FVector> V,N;TArray<FVector2D> UV;TArray<int32> I;
    const int Slices=64,Tube=10;const float MajorR=18.2f,MinorR=2.2f;
    for(int A=0;A<=Slices;A++)for(int B=0;B<=Tube;B++)
    {
        float Alpha=2.f*PI*float(A)/Slices,Beta=2.f*PI*float(B)/Tube;
        const float RR=MajorR+MinorR*FMath::Cos(Beta);
        V.Add(FVector(MinorR*FMath::Sin(Beta),RR*FMath::Sin(Alpha),RR*FMath::Cos(Alpha)));
        N.Add(FVector(FMath::Sin(Beta),FMath::Cos(Beta)*FMath::Sin(Alpha),FMath::Cos(Beta)*FMath::Cos(Alpha)));
        UV.Add(FVector2D(float(A)/Slices,float(B)/Tube));
    }
    for(int A=0;A<Slices;A++)for(int B=0;B<Tube;B++)
    {
        int K=A*(Tube+1)+B;I.Add(K); I.Add(K+Tube+1); I.Add(K+1); I.Add(K+1); I.Add(K+Tube+1); I.Add(K+Tube+2);
    }
    SteeringRim->CreateMeshSection_LinearColor(0,V,I,N,UV,{}, {},false);
}

void ADB4VehiclePawn::ResetCar()
{
    SpeedCmS=0.f;SteerValue=0.f;WheelSpinDegrees=0.f;
    const float S=4000.f;   // arclength in cm: 40 m past the start apron
    FVector At=ADB4Environment::RoadLocation(S);
    At.Z+=60.f;
    SetActorLocation(At);
    SetActorRotation(FRotator(0,ADB4Environment::RoadHeadingDegrees(S),0));
}

float ADB4VehiclePawn::GetEngineRPM() const
{
    float GearRatio=GetGear()==1?3.4f:GetGear()==2?2.1f:GetGear()==3?1.36f:1.0f;
    return FMath::Clamp(760.f+FMath::Abs(SpeedCmS)*GearRatio*1.32f+80.f*FMath::Abs(SteerValue),760.f,6500.f);
}

void ADB4VehiclePawn::Tick(float Dt)
{
    Super::Tick(Dt);
    if(!PC)PC=Cast<APlayerController>(GetController());
    if(!PC)return;
    Dt=FMath::Clamp(Dt,.001f,.05f);
    const auto Down=[this](const FKey& A,const FKey& B){return PC->IsInputKeyDown(A)||PC->IsInputKeyDown(B);};
    const bool Throttle=Down(EKeys::W,EKeys::Up), Brake=Down(EKeys::S,EKeys::Down);
    const float TargetSteer=(Down(EKeys::D,EKeys::Right)?1.f:0.f)-(Down(EKeys::A,EKeys::Left)?1.f:0.f);
    SteerValue=FMath::FInterpTo(SteerValue,TargetSteer,Dt,3.8f);
    const bool CameraPressed=PC->IsInputKeyDown(EKeys::C);
    if(CameraPressed&&!bPreviousCam){CameraMode=(CameraMode+1)%3;DriverCamera->SetActive(CameraMode==0);ChaseCamera->SetActive(CameraMode==1);OrbitCamera->SetActive(CameraMode==2);}
    bPreviousCam=CameraPressed;
    const bool ResetPressed=PC->IsInputKeyDown(EKeys::R);
    if(ResetPressed&&!bPreviousReset)ResetCar(); bPreviousReset=ResetPressed;
    const bool LightPressed=PC->IsInputKeyDown(EKeys::L);
    if(LightPressed&&!bPreviousLight){bHeadlights=!bHeadlights;HeadlightL->SetVisibility(bHeadlights);HeadlightR->SetVisibility(bHeadlights);}bPreviousLight=LightPressed;

    float Acceleration=0.f;
    if(Throttle)Acceleration+=EngineAcceleration;
    if(Brake)Acceleration-=SpeedCmS>80.f?BrakingAcceleration:340.f;
    if(!Throttle&&!Brake)Acceleration-=FMath::Sign(SpeedCmS)*(100.f+.000045f*SpeedCmS*SpeedCmS);
    if(SpeedCmS!=0.f && FMath::Abs(SpeedCmS)<20.f && !Throttle&&!Brake) SpeedCmS=0.f;
    else SpeedCmS+=Acceleration*Dt;
    SpeedCmS=FMath::Clamp(SpeedCmS,-1450.f,MaxForwardKph/0.036f);
    const float SpeedMps=FMath::Abs(SpeedCmS)*.01f;
    // A controlled bicycle model, not Chaos tires: handling scales gently with speed.
    const float SteerRadians=FMath::DegreesToRadians(SteerValue*32.f/(1.f+SpeedMps*.022f));
    const float TurnRadians=SpeedCmS/WheelbaseCm*FMath::Tan(SteerRadians)*Dt;
    const float Yaw=GetActorRotation().Yaw+FMath::RadiansToDegrees(TurnRadians);
    const FVector Forward=FRotator(0,Yaw,0).Vector();
    FVector NewPos=GetActorLocation()+Forward*SpeedCmS*Dt;
    const float Ground=BHRoute::WorldZcm(NewPos.X,NewPos.Y);
    const float RoadDistance=BHRoute::AbsLateralCm(NewPos.X,NewPos.Y);
    const float Surface=BHRoute::SurfaceZcm(NewPos.X,NewPos.Y);
    NewPos.Z=FMath::FInterpTo(GetActorLocation().Z,Surface,Dt,9.f);
    if(RoadDistance>900.f)SpeedCmS=FMath::FInterpTo(SpeedCmS,0.f,Dt,1.3f);
    SetActorLocationAndRotation(NewPos,FRotator(0,Yaw,0));
    WheelSpinDegrees=FMath::Fmod(WheelSpinDegrees+FMath::RadiansToDegrees(SpeedCmS/35.3f*Dt),360.f);
    FrontLeftPivot->SetRelativeRotation(FRotator(0,SteerValue*32.f,0));
    FrontRightPivot->SetRelativeRotation(FRotator(0,SteerValue*32.f,0));
    for(UStaticMeshComponent* M:{FrontLeftMesh.Get(),FrontRightMesh.Get(),RearLeftMesh.Get(),RearRightMesh.Get()}) M->SetRelativeRotation(FRotator(WheelSpinDegrees,0,0));
    SteeringColumn->SetRelativeRotation(FRotator(0,0,-SteerValue*320.f));
    Visual->SetRelativeRotation(FRotator(FMath::Clamp(-Acceleration*.003f,-1.4f,1.4f),0.f,-SteerValue*FMath::Clamp(SpeedMps*.10f,0.f,2.5f)));
    UpdateCamera(Dt);
}

void ADB4VehiclePawn::UpdateCamera(float Dt)
{
    if(!PC)return;
    const float Shake=FMath::Clamp(FMath::Abs(SpeedCmS)/4700.f,0.f,1.f);
    if(CameraMode==0)
    {
        FVector Position(-50.f,-43.f,DriverHeightCm+FMath::Sin(GetWorld()->GetTimeSeconds()*9.f)*Shake*.55f);
        DriverCamera->SetRelativeLocation(FMath::VInterpTo(DriverCamera->GetRelativeLocation(),Position,Dt,5.f));
        DriverCamera->SetRelativeRotation(FRotator(-3.f+CameraPitch,CameraYaw,-SteerValue*.8f));
    }
    if(PC->IsInputKeyDown(EKeys::RightMouseButton))
    {
        float DX=0,DY=0;PC->GetInputMouseDelta(DX,DY);
        CameraYaw=FMath::Clamp(CameraYaw+DX*.12f,-95.f,95.f);
        CameraPitch=FMath::Clamp(CameraPitch+DY*.10f,-37.f,33.f);
        if(CameraMode==2)OrbitCamera->SetRelativeRotation(FRotator(CameraPitch,-CameraYaw,0.f));
    }
    else {CameraYaw=FMath::FInterpTo(CameraYaw,0,Dt,1.1f);CameraPitch=FMath::FInterpTo(CameraPitch,0,Dt,1.1f);}
    ChaseCamera->SetRelativeRotation(FRotator(-9.f,0,0));
    if(CameraMode==2 && !PC->IsInputKeyDown(EKeys::RightMouseButton))OrbitCamera->SetRelativeRotation(FRotator(-12.f,35.f,0));
}
