#pragma once

#include "Kismet/BlueprintFunctionLibrary.h"
#include "DB4MusicIslandLibrary.generated.h"

class APlayerController;
class UDB4MusicIslandWidget;

UCLASS()
class DB4MUSICISLAND_API UDB4MusicIslandLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()
public:
    /** Adds a 2D music HUD to the player's viewport; safe to invoke more than once. */
    UFUNCTION(BlueprintCallable, Category="DB4 Music")
    static UDB4MusicIslandWidget* ShowMusicIsland(APlayerController* PlayerController,
        const FString& PageUrl);

    UFUNCTION(BlueprintCallable, Category="DB4 Music")
    static void HideMusicIsland(APlayerController* PlayerController);
};
