#pragma once
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "DB4GameMode.generated.h"

UCLASS()
class ASTONDB4_API ADB4GameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    ADB4GameMode();
    virtual void StartPlay() override;
};
