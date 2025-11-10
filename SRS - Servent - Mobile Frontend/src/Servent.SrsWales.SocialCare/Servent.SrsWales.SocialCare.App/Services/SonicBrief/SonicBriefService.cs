using Flurl.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Servent.SrsWales.SocialCare.App.Data;
using Servent.SrsWales.SocialCare.App.Services.SonicBrief.Models;

namespace Servent.SrsWales.SocialCare.App.Services.SonicBrief;

public class SonicBriefService
{
    private readonly UserService _authService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<SonicBriefService> _logger;
    private readonly string _apiBaseUrl;
    private readonly StorageService _storageService;

    private NetworkAccess NetworkAccess { get; set; }

    public string StoragePath => Path.Combine(FileSystem.Current.AppDataDirectory);

    public SonicBriefService(IConfiguration configuration, ILogger<SonicBriefService> logger, UserService authService, StorageService storageService)
    {
        _configuration = configuration;
        _logger = logger;
        _apiBaseUrl = _configuration["SonicBrief:ApiBaseUrl"] ?? string.Empty;
        _authService = authService;

        // Ensure data folder exists
        var doesStoragePathExist = Directory.Exists(Path.Combine(StoragePath, "static"));
        if (!doesStoragePathExist)
        {
            Directory.CreateDirectory(StoragePath);
        }

        _storageService = storageService;

        NetworkAccess = Connectivity.NetworkAccess;

        Connectivity.ConnectivityChanged += (object? sender, ConnectivityChangedEventArgs e) =>
        {
            NetworkAccess = e.NetworkAccess;
        };
    }

    public async Task<List<Category>> GetCategoriesAsync()
    {
        try
        {
            if (NetworkAccess != NetworkAccess.Internet)
            {
                _logger.LogWarning("No internet connection. Attempting to load categories from local storage.");
                return await _storageService.GetCategoriesAsync();
            }

            var accessToken = await _authService.GetAccessToken();
            if (string.IsNullOrEmpty(accessToken))
            {
                _logger.LogWarning("Access token is not set. Attempting to load categories from local storage.");
                return await _storageService.GetCategoriesAsync();
            }

            var url = $"{_apiBaseUrl}/prompts/categories";
            var categories = await url.WithOAuthBearerToken(accessToken).WithTimeout(10).GetJsonAsync<List<Category>>();
            if (categories != null && categories.Count > 0)
            {
                // Save categories to local storage
                await _storageService.SetCategoriesAsync(categories);
            }

            return categories ?? [];
        }
        catch (FlurlHttpException ex)
        {
            _logger.LogError(ex, "Error fetching categories from SonicBrief API");
            return [];
        }
    }

    public async Task<List<Subcategory>> GetSubcategoriesAsync()
    {
        try
        {
            if (NetworkAccess != NetworkAccess.Internet)
            {
                _logger.LogWarning("No internet connection. Attempting to load subcategories from local storage.");
                return await _storageService.GetSubcategoriesAsync();
            }

            var accessToken = await _authService.GetAccessToken();
            if (string.IsNullOrEmpty(accessToken))
            {
                _logger.LogWarning("Access token is not set. Attempting to load subcategories from local storage.");
                return await _storageService.GetSubcategoriesAsync();
            }

            var url = $"{_apiBaseUrl}/prompts/subcategories";
            var subcategories = await url.WithOAuthBearerToken(accessToken).WithTimeout(10).GetJsonAsync<List<Subcategory>>();
            if (subcategories != null && subcategories.Count > 0)
            {
                // Save subcategories to local storage
                await _storageService.SetSubcategoriesAsync(subcategories);
            }

            return subcategories ?? [];
        }
        catch (FlurlHttpException ex)
        {
            _logger.LogError(ex, "Error fetching subcategories from SonicBrief API");
            return [];
        }
    }

    public async Task<UploadResponse?> UploadAsync(Recording recording)
    {
        try
        {
            if (NetworkAccess != NetworkAccess.Internet)
            {
                _logger.LogWarning("No internet connection. Cannot upload recording.");
                return null;
            }

            var accessToken = await _authService.GetAccessToken();
            if (string.IsNullOrEmpty(accessToken))
            {
                _logger.LogWarning("Access token is not set. Cannot upload recording.");
                return null;
            }

            if (string.IsNullOrWhiteSpace(recording.RecordingPath) || !File.Exists(recording.RecordingPath))
            {
                _logger.LogWarning($"Recording file not found at path: {recording.RecordingPath}");
                return null;
            }

            using var recordingStream = File.OpenRead(recording.RecordingPath);

            var url = $"{_apiBaseUrl}/upload/uploadmobile";
            var response = await url
                .WithOAuthBearerToken(accessToken)
                .WithTimeout(10)
                .PostMultipartAsync(mp => mp
                    .AddFile("file", recordingStream, Path.GetFileName(recording.RecordingPath))
                    .AddString("prompt_category_id", recording.Category.Id)
                    .AddString("prompt_subcategory_id", recording.SubCategory.Id)
                    .AddString("recording_user_email", recording.Creator)
                    .AddString("case_id", recording.CaseId)
                )
                .ReceiveJson<UploadResponse>();

            return response;
        }
        catch (FlurlHttpException ex)
        {
            _logger.LogError(ex, "Error uploading recording to SonicBrief API");
            return null;
        }
    }

    public async Task<JobsResponse?> GetJobs()
    {
        try
        {
            if (NetworkAccess != NetworkAccess.Internet)
            {
                _logger.LogWarning("No internet connection. Cannot retrive jobs.");
                return null;
            }

            var accessToken = await _authService.GetAccessToken();
            if (string.IsNullOrEmpty(accessToken))
            {
                _logger.LogWarning("Access token is not set. Cannot retrive jobs.");
                return null;
            }

            var url = $"{_apiBaseUrl}/upload/jobsmobilequery";
            var response = await url
                .WithOAuthBearerToken(accessToken)
                .WithTimeout(10)
                .GetAsync()
                .ReceiveJson<JobsResponse>();

            return response;
        }
        catch (FlurlHttpException ex)
        {
            _logger.LogError(ex, "Error retrieving jobs from SonicBrief API");
            return null;
        }
    }

    public async Task<string?> GetTranscription(string jobId)
    {
        try
        {
            if (NetworkAccess != NetworkAccess.Internet)
            {
                _logger.LogWarning("No internet connection. Cannot retrive transcription.");
                return null;
            }

            var accessToken = await _authService.GetAccessToken();
            if (string.IsNullOrEmpty(accessToken))
            {
                _logger.LogWarning("Access token is not set. Cannot retrive transcription.");
                return null;
            }

            var url = $"{_apiBaseUrl}/upload/jobs/transcription/{jobId}";
            var response = await url
                .WithOAuthBearerToken(accessToken)
                .WithTimeout(10)
                .GetAsync()
                .ReceiveString();

            return response;
        }
        catch (FlurlHttpException ex)
        {
            _logger.LogError(ex, "Error retrieving transcription from SonicBrief API");
            return null;
        }
    }
}
