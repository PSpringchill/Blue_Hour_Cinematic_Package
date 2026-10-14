#include "DB4MusicIslandLibrary.h"
#include "DB4MusicIslandWidget.h"
#include "Blueprint/UserWidget.h"
#include "GameFramework/PlayerController.h"
#include "UObject/UObjectIterator.h"

static UDB4MusicIslandWidget* FindIsland(APlayerController* PC)
{
    if (!IsValid(PC)) return nullptr;
    for (TObjectIterator<UDB4MusicIslandWidget> It; It; ++It)
    {
        UDB4MusicIslandWidget* Existing = *It;
        if (IsValid(Existing) && Existing->GetOwningPlayer() == PC && Existing->IsInViewport())
        {
            return Existing;
        }
    }
    return nullptr;
}

UDB4MusicIslandWidget* UDB4MusicIslandLibrary::ShowMusicIsland(APlayerController* PC, const FString& PageUrl)
{
    if (!IsValid(PC) || !PC->IsLocalController()) return nullptr;
    if (UDB4MusicIslandWidget* Existing = FindIsland(PC)) return Existing;
    UDB4MusicIslandWidget* Widget = CreateWidget<UDB4MusicIslandWidget>(PC, UDB4MusicIslandWidget::StaticClass());
    if (!Widget) return nullptr;
    if (!PageUrl.IsEmpty()) Widget->MusicPageUrl = PageUrl;
    Widget->AddToViewport(900);
    return Widget;
}

void UDB4MusicIslandLibrary::HideMusicIsland(APlayerController* PC)
{
    if (UDB4MusicIslandWidget* Widget = FindIsland(PC))
    {
        Widget->PausePlayback();
        Widget->RemoveFromParent();
    }
}
