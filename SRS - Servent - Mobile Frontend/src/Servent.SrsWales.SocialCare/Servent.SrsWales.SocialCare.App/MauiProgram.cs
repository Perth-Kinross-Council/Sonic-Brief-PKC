using System.Reflection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Plugin.Maui.Audio;
using Radzen;
using Servent.SrsWales.SocialCare.App.Data.Forms;
using Servent.SrsWales.SocialCare.App.Services;
using Servent.SrsWales.SocialCare.App.Services.SonicBrief;

namespace Servent.SrsWales.SocialCare.App
{
    public static class MauiProgram
    {
        public static IServiceProvider? ServiceProvider { get; private set; }

        public static MauiApp CreateMauiApp()
        {
            var builder = MauiApp.CreateBuilder();
            builder
                .UseMauiApp<App>()
                .ConfigureFonts(fonts =>
                {
                    fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular");
                });

            var a = Assembly.GetExecutingAssembly();
            var appSettings = $"{a.GetName().Name}.appsettings.json";
            using var stream = a.GetManifestResourceStream(appSettings);
            var config = new ConfigurationBuilder().AddJsonStream(stream).Build();
            builder.Configuration.AddConfiguration(config);

            builder.Services.AddMauiBlazorWebView();
            builder.Services.AddRadzenComponents();
            builder.Services.AddSingleton(Connectivity.Current);

            builder.AddAudio();
            builder.Services.AddSingleton<IAudioRecordingService, AudioRecordingService>();
            builder.Services.AddSingleton<IAudioPlayerService, AudioPlayerService>();
            builder.Services.AddSingleton<SonicBriefService>();
            builder.Services.AddSingleton<StorageService>();
            builder.Services.AddSingleton<UserService>();
            builder.Services.AddSingleton<RecordForm>();
            builder.Services.AddSingleton<RecordPageState>();

#if DEBUG
            builder.Services.AddBlazorWebViewDeveloperTools();
            builder.Logging.AddDebug();
#endif

            builder.Services.AddSingleton<MsalAuthenticationService>();

            var app = builder.Build();
            ServiceProvider = app.Services;
            return app;
        }
    }
}