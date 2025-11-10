using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Plugin.Maui.Audio;

namespace Servent.SrsWales.SocialCare.App.Services
{
    public interface IAudioRecordingService
    {
        Task StartAsync();
        Task StartAsync(string filePath);
        Task<IAudioSource> StopAsync();
        Task PauseAsync();
        Task ResumeAsync();
        void ResetTimers();

        bool IsRecording { get; }
        bool IsPaused { get; }
        string RecordingsPath { get; }

        TimeSpan RecordingElapsed { get; }
        event Action? RecordingElapsedChanged;
    }

    public class AudioRecordingService : IAudioRecordingService
    {
        private IAudioManager _audioManager;
        private IAudioRecorder _audioRecorder;
        private readonly ILogger<AudioRecordingService> _logger;

        private readonly Stopwatch _stopwatch = new();
        private readonly System.Timers.Timer _refreshTimer;

        public event Action? RecordingElapsedChanged;

        // Force settings for now based on Android recommended settings
        private AudioRecorderOptions _recorderOptions = new AudioRecorderOptions()
        {
            Channels = ChannelType.Mono,
            BitDepth = BitDepth.Pcm16bit,
            Encoding = Encoding.Aac,
            ThrowIfNotSupported = true
        };

        public bool IsRecording => _audioRecorder?.IsRecording ?? false;
        public bool IsPaused => _audioRecorder?.IsPaused ?? false;
        public string RecordingsPath => Path.Combine(FileSystem.Current.CacheDirectory, "recordings");
        public TimeSpan RecordingElapsed => _stopwatch.Elapsed;

        public AudioRecordingService(IAudioManager audioManager, ILogger<AudioRecordingService> logger)
        {
            _audioManager = audioManager;
            _audioRecorder = audioManager.CreateRecorder();
            _logger = logger;

            // Ensure recordings folder exists
            var doesRecordingsFolderExist = Directory.Exists(RecordingsPath);
            if (!doesRecordingsFolderExist)
            {
                Directory.CreateDirectory(RecordingsPath);
            }

            _refreshTimer = new System.Timers.Timer(1000);
            _refreshTimer.Elapsed += (s, e) =>
            {
                RecordingElapsedChanged?.Invoke();
            };
        }

        public async Task StartAsync()
        {
            await _audioRecorder.StartAsync(_recorderOptions);

            _stopwatch.Restart();
            _refreshTimer.Start();
            RecordingElapsedChanged?.Invoke();
        }

        public async Task StartAsync(string filePath)
        {
            try
            {
                // Ensure recordings folder exists for each user
                var recordingsFolder = Path.GetDirectoryName(filePath);
                if (string.IsNullOrEmpty(recordingsFolder))
                {
                    _logger.LogError("Invalid file path provided for audio recording: {filePath}", filePath);
                    return;
                }

                var doesRecordingsFolderExist = Directory.Exists(recordingsFolder);
                if (!doesRecordingsFolderExist)
                {
                    Directory.CreateDirectory(recordingsFolder);
                }

                await _audioRecorder.StartAsync(filePath, _recorderOptions);

                _stopwatch.Restart();
                _refreshTimer.Start();
                RecordingElapsedChanged?.Invoke();
            }
            catch (Exception ex)
            {
                _logger.LogError("Error starting audio recording: {error}", ex.Message);
            }
        }

        public async Task<IAudioSource> StopAsync()
        {
            var result = await _audioRecorder.StopAsync();

            _stopwatch.Stop();
            _refreshTimer.Stop();
            RecordingElapsedChanged?.Invoke();

            return result;
        }

        public async Task PauseAsync()
        {
            await _audioRecorder.PauseAsync();

            _stopwatch.Stop();
            _refreshTimer.Stop();
            RecordingElapsedChanged?.Invoke();
        }

        public async Task ResumeAsync()
        {
            await _audioRecorder.ResumeAsync();

            _stopwatch.Start();
            _refreshTimer.Start();
            RecordingElapsedChanged?.Invoke();
        }

        public void ResetTimers()
        {
            _stopwatch.Reset();
            _refreshTimer.Stop();
            RecordingElapsedChanged?.Invoke();
        }
    }
}