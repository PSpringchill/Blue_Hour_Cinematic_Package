#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "DB4MusicIslandWidget.generated.h"

class UWebBrowser;

/** UE overlay. YouTube itself runs in the unmodified official iframe player. */
UCLASS()
class DB4MUSICISLAND_API UDB4MusicIslandWidget : public UUserWidget
{
    GENERATED_BODY()
public:
    /** Host the included Resources/Web directory on localhost for a valid HTTP Referer. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="DB4 Music")
    FString MusicPageUrl = TEXT("http://127.0.0.1:8766/");

    /** When hiding the overlay, call PausePlayback first. */
    UFUNCTION(BlueprintCallable, Category="DB4 Music")
    void PausePlayback();

protected:
    virtual void NativeOnInitialized() override;
    virtual void NativeConstruct() override;
    virtual void NativeDestruct() override;

private:
    UPROPERTY(Transient)
    TObjectPtr<UWebBrowser> Browser;
};
