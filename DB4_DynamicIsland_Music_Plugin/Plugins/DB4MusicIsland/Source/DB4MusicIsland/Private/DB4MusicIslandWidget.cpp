#include "DB4MusicIslandWidget.h"
#include "WebBrowser.h"
#include "Blueprint/WidgetTree.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"

void UDB4MusicIslandWidget::NativeOnInitialized()
{
    Super::NativeOnInitialized();
    if (!WidgetTree || WidgetTree->RootWidget)
    {
        return;
    }

    UCanvasPanel* Root = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("MusicIslandRoot"));
    WidgetTree->RootWidget = Root;
    Root->SetVisibility(ESlateVisibility::SelfHitTestInvisible); // Preserve driving input outside the browser panel.

    Browser = WidgetTree->ConstructWidget<UWebBrowser>(UWebBrowser::StaticClass(), TEXT("MusicIslandBrowser"));
    UCanvasPanelSlot* Slot = Root->AddChildToCanvas(Browser);
    Slot->SetAnchors(FAnchors(1.f, 0.f, 1.f, 0.f));
    Slot->SetAlignment(FVector2D(1.f, 0.f));
    Slot->SetPosition(FVector2D(-20.f, 20.f));
    Slot->SetSize(FVector2D(486.f, 750.f));
}

void UDB4MusicIslandWidget::NativeConstruct()
{
    Super::NativeConstruct();
    if (Browser)
    {
        Browser->LoadURL(MusicPageUrl);
    }
}

void UDB4MusicIslandWidget::PausePlayback()
{
    if (Browser)
    {
        Browser->ExecuteJavascript(TEXT("window.DB4Music && window.DB4Music.pause();"));
    }
}

void UDB4MusicIslandWidget::NativeDestruct()
{
    PausePlayback();
    if (Browser)
    {
        // Loading about:blank tears down the player, so YouTube playback cannot continue hidden.
        Browser->LoadURL(TEXT("about:blank"));
    }
    Super::NativeDestruct();
}
