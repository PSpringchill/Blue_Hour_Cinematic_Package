#pragma once
#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "DB4HUD.generated.h"
UCLASS()
class ASTONDB4_API ADB4HUD : public AHUD
{
    GENERATED_BODY()
public:
    virtual void DrawHUD() override;
};
