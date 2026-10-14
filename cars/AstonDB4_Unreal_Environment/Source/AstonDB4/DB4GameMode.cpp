#include "DB4GameMode.h"
#include "DB4VehiclePawn.h"
#include "DB4Environment.h"
#include "DB4HUD.h"
#include "Engine/World.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/SkyAtmosphere.h"
#include "Engine/VolumetricCloud.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "EngineUtils.h"

ADB4GameMode::ADB4GameMode()
{
    DefaultPawnClass=ADB4VehiclePawn::StaticClass();
    HUDClass=ADB4HUD::StaticClass();
}
void ADB4GameMode::StartPlay()
{
    UWorld* W=GetWorld();
    if(W)
    {
        if(!TActorIterator<ADB4Environment>(W))
        {
            W->SpawnActor<ADB4Environment>(ADB4Environment::StaticClass(),FVector::ZeroVector,FRotator::ZeroRotator);
        }
        if(!TActorIterator<ADirectionalLight>(W))
        {
            ADirectionalLight* Sun=W->SpawnActor<ADirectionalLight>();
            Sun->SetActorRotation(FRotator(-38.f,-23.f,0.f));
            auto* L=Sun->GetComponent();
            L->SetMobility(EComponentMobility::Movable);
            L->SetIntensity(65000.f);
            L->SetLightColor(FLinearColor(1.f,.87f,.71f));
            L->bAtmosphereSunLight=true;
            L->MarkRenderStateDirty();
        }
        if(!TActorIterator<ASkyLight>(W))
        {
            ASkyLight* Sky=W->SpawnActor<ASkyLight>();
            auto* L=Sky->GetLightComponent();
            L->SetMobility(EComponentMobility::Movable);
            L->SetIntensity(1.1f);
            L->SetRealTimeCapture(true);
        }
        if(!TActorIterator<ASkyAtmosphere>(W)) W->SpawnActor<ASkyAtmosphere>();
        if(!TActorIterator<AVolumetricCloud>(W)) W->SpawnActor<AVolumetricCloud>();
        if(!TActorIterator<AExponentialHeightFog>(W))
        {
            AExponentialHeightFog* Fog=W->SpawnActor<AExponentialHeightFog>();
            auto* C=Fog->GetComponent();
            C->SetFogDensity(.009f);
            C->SetFogHeightFalloff(.22f);
            C->SetVolumetricFog(true);
        }
    }
    Super::StartPlay();
}
