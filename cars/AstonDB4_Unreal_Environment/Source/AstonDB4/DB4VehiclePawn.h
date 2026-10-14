#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "DB4VehiclePawn.generated.h"
class USceneComponent;
class UCameraComponent;
class UStaticMeshComponent;
class UProceduralMeshComponent;
class USpotLightComponent;
class APlayerController;

UCLASS(Blueprintable)
class ASTONDB4_API ADB4VehiclePawn : public APawn
{
    GENERATED_BODY()
public:
    ADB4VehiclePawn();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Driving")
    float MaxForwardKph=165.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Driving")
    float EngineAcceleration=515.f; // cm/s^2, illustrative driving dynamics
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Driving")
    float BrakingAcceleration=1300.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Driving")
    float WheelbaseCm=246.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Camera")
    float DriverHeightCm=113.f;

    UFUNCTION(BlueprintPure, Category="Driving") float GetSpeedKph() const {return FMath::Abs(SpeedCmS)*.036f;}
    UFUNCTION(BlueprintPure, Category="Driving") float GetSteeringDegrees() const {return SteerValue*32.f;}
    UFUNCTION(BlueprintPure, Category="Driving") int32 GetGear() const {return SpeedCmS< -8.f ? -1 : SpeedCmS<180.f ? 1 : SpeedCmS<470.f ? 2 : SpeedCmS<820.f ? 3 : 4;}
    UFUNCTION(BlueprintPure, Category="Driving") float GetEngineRPM() const;
    UFUNCTION(BlueprintPure, Category="Driving") int32 GetCameraMode() const {return CameraMode;}
    UFUNCTION(BlueprintPure, Category="Driving") bool HasHeadlightsOn() const {return bHeadlights;}

private:
    UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> Chassis;
    UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> Visual;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> CarBody;
    UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> FrontLeftPivot;
    UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> FrontRightPivot;
    UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> RearLeftPivot;
    UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> RearRightPivot;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> FrontLeftMesh;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> FrontRightMesh;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> RearLeftMesh;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> RearRightMesh;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Dashboard;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> CenterTunnel;
    UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> SteeringColumn;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UProceduralMeshComponent> SteeringRim;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> SteeringHub;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> DriverCamera;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> ChaseCamera;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> OrbitCamera;
    UPROPERTY(VisibleAnywhere) TObjectPtr<USpotLightComponent> HeadlightL;
    UPROPERTY(VisibleAnywhere) TObjectPtr<USpotLightComponent> HeadlightR;

    float SpeedCmS=0.f,SteerValue=0.f,WheelSpinDegrees=0.f;
    float CameraYaw=0.f,CameraPitch=0.f;
    int32 CameraMode=0;
    bool bHeadlights=false;
    bool bPreviousCam=false,bPreviousReset=false,bPreviousLight=false;
    APlayerController* PC=nullptr;
    void LoadCarMeshes();
    void SetCarMesh(UStaticMeshComponent* Component, const TCHAR* AssetPath, const FVector& AnchorCm, bool bWheel);
    void BuildSteeringRing();
    void UpdateCamera(float DeltaSeconds);
    void ResetCar();
};
