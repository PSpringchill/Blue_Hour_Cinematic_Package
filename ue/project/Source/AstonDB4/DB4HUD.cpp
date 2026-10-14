#include "DB4HUD.h"
#include "DB4VehiclePawn.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "GameFramework/PlayerController.h"
#include "UObject/ConstructorHelpers.h"

void ADB4HUD::DrawHUD()
{
    Super::DrawHUD();
    if(!Canvas || !PlayerOwner || !GEngine) return;
    const ADB4VehiclePawn* Car=Cast<ADB4VehiclePawn>(PlayerOwner->GetPawn());
    if(!Car)return;
    UFont* Font=GEngine->GetSmallFont();
    const float X=42.f,Y=Canvas->ClipY-178.f;
    const FLinearColor White(.94f,.96f,.95f,1.f), Dim(.56f,.75f,.72f,1.f), Accent(.85f,.64f,.34f,1.f);
    DrawRect(FLinearColor(.008f,.013f,.018f,.75f),X-14.f,Y-10.f,290.f,154.f);
    DrawText(TEXT("ASTON MARTIN   |   DB4 GT ZAGATO"),Dim,X,Y,Font,1.00f,false);
    DrawText(FString::Printf(TEXT("%03.0f"),Car->GetSpeedKph()),White,X,Y+22.f,Font,2.8f,false);
    DrawText(TEXT("KM/H"),Accent,X+116.f,Y+55.f,Font,1.1f,false);
    DrawText(FString::Printf(TEXT("RPM  %04.0f    GEAR  %d"),Car->GetEngineRPM(),Car->GetGear()),White,X,Y+90.f,Font,1.05f,false);
    DrawText(FString::Printf(TEXT("STEER %+.1f DEG   |   %s"),Car->GetSteeringDegrees(),Car->GetCameraMode()==0?TEXT("COCKPIT"):Car->GetCameraMode()==1?TEXT("CHASE"):TEXT("ORBIT")),Dim,X,Y+116.f,Font,.94f,false);
    const FString Guide=TEXT("WASD / ARROWS  DRIVE     C  CAMERA     R  RESET     L  LIGHTS     RMB  LOOK");
    DrawText(Guide,FLinearColor(.8f,.83f,.79f,1.f),36.f,24.f,Font,.9f,false);
}
