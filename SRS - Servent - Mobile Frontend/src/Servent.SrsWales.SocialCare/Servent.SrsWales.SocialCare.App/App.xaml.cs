using Servent.SrsWales.SocialCare.App.Services;

namespace Servent.SrsWales.SocialCare.App;

public partial class App : Application
{
    public App()
    {
        InitializeComponent();
    }

    protected override Window CreateWindow(IActivationState? activationState)
    {
        return new Window(new MainPage()) { Title = "Servent.SrsWales.SocialCare.App" };
    }

    protected override async void OnStart()
    {
        var provider = MauiProgram.ServiceProvider;
        if (provider != null)
        {
            var storageProvider = provider.GetRequiredService<StorageService>();
            await storageProvider.RemoveOldRecordings();
        }

        base.OnStart();
    }

    protected override void OnResume()
    {
        base.OnResume();
    }
}
