#include "DB4GameMode.h"
#include "DB4VehiclePawn.h"
#include "DB4Environment.h"
#include "DB4HUD.h"
#include "Engine/World.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Components/SceneComponent.h"
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
            // Blue hour: sun disc just under the horizon (pitch = -elevation),
            // cool light, low lux — SkyAtmosphere carries the scene.
            ADirectionalLight* Sun=W->SpawnActor<ADirectionalLight>();
            Sun->SetActorRotation(FRotator(0.8f,25.f,0.f));
            auto* L=Sun->GetComponent();
            L->SetMobility(EComponentMobility::Movable);
            L->SetIntensity(6.f);
            L->SetLightColor(FLinearColor(.42f,.62f,.92f));
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
        // UE 5.8: sky atmosphere and volumetric clouds are components, not
        // dedicated actor classes — spawn a plain actor per component.
        bool bHasSky=false,bHasCloud=false;
        for(TActorIterator<AActor> It(W);It;++It)
        {
            if(It->FindComponentByClass<USkyAtmosphereComponent>())bHasSky=true;
            if(It->FindComponentByClass<UVolumetricCloudComponent>())bHasCloud=true;
        }
        if(!bHasSky)
        {
            AActor* Sky=W->SpawnActor<AActor>();
            auto* C=NewObject<USkyAtmosphereComponent>(Sky);
            Sky->SetRootComponent(C); C->RegisterComponent();
        }
        if(!bHasCloud)
        {
            AActor* Cloud=W->SpawnActor<AActor>();
            auto* C=NewObject<UVolumetricCloudComponent>(Cloud);
            Cloud->SetRootComponent(C); C->RegisterComponent();
        }
        if(!TActorIterator<AExponentialHeightFog>(W))
        {
            AExponentialHeightFog* Fog=W->SpawnActor<AExponentialHeightFog>();
            auto* C=Fog->GetComponent();
            C->SetFogDensity(.006f);
            C->SetFogHeightFalloff(.22f);
            C->SetVolumetricFog(true);
        }
    }
    Super::StartPlay();
}
