import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMsal } from "@azure/msal-react";
import { useEnhancedUnifiedAuth } from "@/lib/useEnhancedUnifiedAuth";
import { fetchJsonStrict } from "@/lib/api";
import { apiUrl } from "@/lib/apiUrl";
import { useAuthManager } from "@/lib/auth-manager-context";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Download,
  RefreshCw,
  Settings,
  Copy,
  Check,
  Activity,
  Shield,
  Timer,
  Users
} from "lucide-react";
import { debugConfig } from "../env";

interface TestResult {
  name: string;
  status: 'pending' | 'running' | 'success' | 'warning' | 'error';
  result?: string;
  details?: string;
  timestamp?: string;
}

interface EndpointTest {
  name: string;
  url: string;
  method: string;
  needsAuth: boolean;
}

interface BackendAuthStats {
  authentication?: {
    method: string;
    enabled_methods: string[];
    legacy_enabled: boolean;
    entra_enabled: boolean;
  };
  services?: {
    app_config?: any;
    cosmos_db?: any;
    entra_service?: any;
    auth_cache?: any;
  };
  jwks_stats?: any;
  cache_stats?: any;
}


export function DiagnosticPanel() {
  if (!debugConfig.isEnabled()) return null;
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("tests");
  const [tests, setTests] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [logEntries, setLogEntries] = useState<string[]>([]);
  const [copiedRecently, setCopiedRecently] = useState(false);
  const [backendStats, setBackendStats] = useState<BackendAuthStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { instance, accounts } = useMsal();
  const enhancedAuth = useEnhancedUnifiedAuth();
  const authManager = useAuthManager();

  const log = useCallback((message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
  setLogEntries(prev => [...prev, entry]); // Removed commented console logging
  }, []);

  const updateTest = useCallback((name: string, updates: Partial<TestResult>) => {
    setTests(prev => prev.map(test =>
      test.name === name
        ? { ...test, ...updates, timestamp: new Date().toLocaleTimeString() }
        : test
    ));
  }, []);

  const getAuthToken = useCallback(async (): Promise<string | null> => {
    try {
      log('Starting token acquisition using app\'s hybrid approach', 'info');

      // Try MSAL first (like the main app does)
      if (enhancedAuth.isAuthenticated && instance && accounts.length > 0) {
        try {
          const account = accounts[0];
          const audience = import.meta.env.VITE_AZURE_AUDIENCE || 'api://71bea96c-7f27-4eae-9310-14aeb4ebd598';
          log(`Trying MSAL with audience: ${audience}`, 'info');

          if (typeof instance.acquireTokenSilent === 'function') {
            const tokenRequest = {
              account,
              scopes: [`${audience}/.default`],
            };

            const response = await instance.acquireTokenSilent(tokenRequest);
            log(`MSAL token acquired successfully (expires: ${new Date(response.expiresOn!).toLocaleString()})`, 'success');
            return response.accessToken;
          } else {
            log('MSAL instance does not have acquireTokenSilent method', 'warning');
          }
        } catch (msalError: any) {
          log(`MSAL failed: ${msalError.message || msalError}`, 'warning');
        }
      } else {
        log('MSAL not available (not authenticated or no accounts)', 'info');
      }

      // Fall back to legacy token from localStorage (like the main app does)
      log('Trying legacy token from localStorage', 'info');
      const legacyToken = localStorage.getItem('token');
      if (legacyToken) {
        // Validate the legacy token
        try {
          const [, payloadBase64] = legacyToken.split('.');
          if (payloadBase64) {
            const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp > now) {
              log(`Legacy token is valid (expires: ${new Date(payload.exp * 1000).toLocaleString()})`, 'success');
              return legacyToken;
            } else {
              log('Legacy token is expired', 'warning');
            }
          }
        } catch (parseError) {
          log(`Legacy token parsing failed: ${parseError}`, 'warning');
        }
      } else {
        log('No legacy token found in localStorage', 'warning');
      }

      log('No valid token found via MSAL or legacy authentication', 'error');
      return null;
    } catch (error) {
      log(`Token acquisition failed: ${error}`, 'error');
      return null;
    }
  }, [enhancedAuth.isAuthenticated, instance, accounts, log]);

  const fetchBackendAuthStats = useCallback(async () => {
    try {
  const token = await authManager.getToken();

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

    // Fetch auth info (use centralized apiUrl for actual calls)
  let authInfo = null as any;
  try { authInfo = await fetchJsonStrict(apiUrl(`/admin/auth/info`), { headers }); } catch { authInfo = null; }

    // Fetch health check
  let health = null as any;
  try { health = await fetchJsonStrict(apiUrl(`/admin/auth/health`), { headers }); } catch { health = null; }

    // Fetch cache stats
  let cacheStats = null as any;
  try { cacheStats = await fetchJsonStrict(apiUrl(`/admin/auth/cache/stats`), { headers }); } catch { cacheStats = null; }

    // Fetch JWKS stats if available
  let jwksStats = null as any;
  try { jwksStats = await fetchJsonStrict(apiUrl(`/admin/auth/admin/jwks/stats`), { headers }); } catch { jwksStats = null; }

      setBackendStats({
        authentication: authInfo?.authentication,
        services: health?.services,
        cache_stats: cacheStats?.cache_stats,
        jwks_stats: jwksStats?.jwks_stats
      });

      log('Backend auth stats fetched successfully', 'success');
    } catch (error) {
      log(`Failed to fetch backend auth stats: ${error}`, 'error');
    }
  }, [enhancedAuth, log]);

  const refreshAuthState = useCallback(async () => {
    setRefreshing(true);
    try {
      authManager.clearCache();
      await fetchBackendAuthStats();
      log('Authentication state refreshed successfully', 'success');
    } catch (error) {
      log(`Failed to refresh auth state: ${error}`, 'error');
    } finally {
      setRefreshing(false);
    }
  }, [enhancedAuth, fetchBackendAuthStats, log]);

  // Fetch backend stats when panel opens
  useEffect(() => {
    if (isOpen) {
      fetchBackendAuthStats();
    }
  }, [isOpen, fetchBackendAuthStats]);

  const runEndpointTests = useCallback(async () => {
    // Get backend URL from environment for logging (requests use apiUrl)
    const backendUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_BASE_URL || '(unset)';

    log(`Using backend URL: ${backendUrl}`);
    log(`Environment variables: VITE_API_URL=${import.meta.env.VITE_API_URL}, VITE_BASE_URL=${import.meta.env.VITE_BASE_URL}`);

    const endpoints: EndpointTest[] = [
      { name: 'Root Endpoint', url: apiUrl(`/`), method: 'GET', needsAuth: false },
      { name: 'Health Check', url: apiUrl(`/health`), method: 'GET', needsAuth: false },
      { name: 'Docs Endpoint', url: apiUrl(`/docs`), method: 'GET', needsAuth: false },
      { name: 'Jobs List', url: apiUrl(`/jobs`), method: 'GET', needsAuth: true },
      { name: 'Retrieve Prompts', url: apiUrl(`/retrieve_prompts`), method: 'GET', needsAuth: true },
      { name: 'Categories', url: apiUrl(`/categories`), method: 'GET', needsAuth: true },
    ];

    let token: string | null = null;

    // Get auth token for authenticated endpoints if any exist
    const authEndpoints = endpoints.filter(e => e.needsAuth);
    if (authEndpoints.length > 0) {
      updateTest('Token Acquisition', { status: 'running' });
      token = await getAuthToken();
      updateTest('Token Acquisition', {
        status: token ? 'success' : 'error',
        result: token ? 'Token acquired successfully' : 'Failed to acquire token',
        details: token ? `Token length: ${token.length} characters` : 'Check authentication status'
      });
    }

    // Test each endpoint
    for (const endpoint of endpoints) {
      updateTest(endpoint.name, { status: 'running' });
      log(`Testing ${endpoint.name}: ${endpoint.method} ${endpoint.url}`);

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (endpoint.needsAuth && token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(endpoint.url, {
          method: endpoint.method,
          headers,
          mode: 'cors'
        });

        const statusClass = response.ok ? 'success' : 'error';
        const resultText = `${response.status} ${response.statusText}`;

        log(`${endpoint.name}: ${resultText}`);

        // Try to get response body for additional details
        let details = `Status: ${response.status}`;
        try {
          const text = await response.text();
          if (text && text.length < 500) {
            details += `\nResponse: ${text}`;
          } else if (text) {
            details += `\nResponse: ${text.substring(0, 200)}...`;
          }
        } catch (e) {
          details += '\nCould not read response body';
        }

        updateTest(endpoint.name, {
          status: statusClass as 'success' | 'error',
          result: resultText,
          details
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log(`${endpoint.name}: ERROR - ${errorMessage}`, 'error');

        updateTest(endpoint.name, {
          status: 'error',
          result: `Error: ${errorMessage}`,
          details: error instanceof Error ? error.stack : 'No stack trace available'
        });
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }, [getAuthToken, updateTest, log]);

  const runFFmpegTest = useCallback(async () => {
    updateTest('FFmpeg Test', { status: 'running' });
    log('Testing FFmpeg WebAssembly availability...');

    try {
      // Check if FFmpeg class is available
      if (typeof window !== 'undefined' && 'FFmpeg' in window) {
        log('FFmpeg class found in global scope');
        updateTest('FFmpeg Test', {
          status: 'success',
          result: 'FFmpeg available in global scope',
          details: 'WebAssembly support confirmed'
        });
      } else {
        // Try dynamic import
        try {
          // Dynamic import is intentional to avoid heavy upfront bundle and only load when needed
          const { FFmpeg } = await import('@ffmpeg/ffmpeg');
          log('FFmpeg imported successfully via dynamic import');

          // Try to create an instance
          const ffmpeg = new FFmpeg();
          log('FFmpeg instance created successfully');

          // Test if we can access FFmpeg methods
          const hasLoad = typeof ffmpeg.load === 'function';
          const hasExec = typeof ffmpeg.exec === 'function';

          updateTest('FFmpeg Test', {
            status: 'success',
            result: 'FFmpeg loaded via dynamic import',
            details: `Instance creation successful. Methods: load(${hasLoad}), exec(${hasExec})`
          });
        } catch (importError) {
          log(`FFmpeg import failed: ${importError}`, 'error');
          updateTest('FFmpeg Test', {
            status: 'error',
            result: `Import failed: ${importError}`,
            details: 'FFmpeg WebAssembly not available'
          });
        }
      }
    } catch (error) {
      log(`FFmpeg test error: ${error}`, 'error');
      updateTest('FFmpeg Test', {
        status: 'error',
        result: `Error: ${error}`,
        details: 'FFmpeg not available or not properly configured'
      });
    }
  }, [updateTest, log]);

  const runAllTests = useCallback(async () => {
    setIsRunning(true);
    setLogEntries([]);

    // Initialize test list
    const initialTests: TestResult[] = [
      { name: 'Authentication Status', status: 'pending' },
      { name: 'Token Acquisition', status: 'pending' },
      { name: 'Health Check', status: 'pending' },
      { name: 'Docs Endpoint', status: 'pending' },
      { name: 'Jobs List', status: 'pending' },
      { name: 'Retrieve Prompts', status: 'pending' },
      { name: 'Upload Info', status: 'pending' },
      { name: 'FFmpeg Test', status: 'pending' },
    ];

    setTests(initialTests);
    log('Starting comprehensive diagnostic tests...');

    // Test 1: Authentication Status
    updateTest('Authentication Status', { status: 'running' });
    log(`Authentication status: ${enhancedAuth.isAuthenticated ? 'Authenticated' : 'Not authenticated'}`);
    log(`User: ${accounts.length > 0 ? accounts[0].name || accounts[0].username : 'Unknown'}`);
    log(`Accounts: ${accounts.length}`);

    updateTest('Authentication Status', {
      status: enhancedAuth.isAuthenticated ? 'success' : 'error',
      result: enhancedAuth.isAuthenticated ? `Authenticated as ${accounts.length > 0 ? accounts[0].name || accounts[0].username : 'Unknown'}` : 'Not authenticated',
      details: `Accounts: ${accounts.length}, Pending: ${enhancedAuth.pending}`
    });

    // Test 2-7: Endpoint Tests
    await runEndpointTests();

    // Test 8: FFmpeg Test
    await runFFmpegTest();

    log('All diagnostic tests completed');
    setIsRunning(false);
  }, [enhancedAuth.isAuthenticated, accounts, enhancedAuth.pending, runEndpointTests, runFFmpegTest, updateTest, log]);

  const copyToClipboard = useCallback(async () => {
    const testResults = tests.map(test =>
      `${test.name}: ${test.status}${test.result ? ` - ${test.result}` : ''}${test.details ? `\n  Details: ${test.details}` : ''}`
    ).join('\n');

    const fullReport = `Sonic Brief Diagnostic Report
Generated: ${new Date().toISOString()}

TEST RESULTS:
${testResults}

DIAGNOSTIC LOG:
${logEntries.join('\n')}

ENVIRONMENT:
- VITE_API_URL: ${import.meta.env.VITE_API_URL || 'undefined'}
- VITE_BASE_URL: ${import.meta.env.VITE_BASE_URL || 'undefined'}
- VITE_AZURE_CLIENT_ID: ${import.meta.env.VITE_AZURE_CLIENT_ID || 'undefined'}
- VITE_AZURE_TENANT_ID: ${import.meta.env.VITE_AZURE_TENANT_ID || 'undefined'}
- Authentication Status: ${enhancedAuth.isAuthenticated ? 'Authenticated' : 'Not authenticated'}
- Accounts: ${accounts.length}
`;

    try {
      await navigator.clipboard.writeText(fullReport);
      setCopiedRecently(true);
      log('Diagnostic report copied to clipboard');
      setTimeout(() => setCopiedRecently(false), 2000);
    } catch (error) {
      log(`Failed to copy to clipboard: ${error}`, 'error');
    }
  }, [tests, logEntries, enhancedAuth.isAuthenticated, accounts, log]);

  const downloadLog = useCallback(() => {
    const logContent = logEntries.join('\n');
    const blob = new Blob([logContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `frontend-diagnostic-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('Diagnostic log downloaded');
  }, [logEntries, log]);

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'warning': return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'running': return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default: return <div className="h-4 w-4 rounded-full bg-gray-300" />;
    }
  };

  const getStatusBadge = (status: TestResult['status']) => {
    const variants = {
      success: 'bg-green-100 text-green-800',
      warning: 'bg-yellow-100 text-yellow-800',
      error: 'bg-red-100 text-red-800',
      running: 'bg-blue-100 text-blue-800',
      pending: 'bg-gray-100 text-gray-800'
    };

    return (
      <Badge variant="secondary" className={variants[status]}>
        {status}
      </Badge>
    );
  };

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-50"
      >
        <Settings className="h-4 w-4 mr-2" />
        Diagnostics
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-4 left-4 w-[600px] max-h-[80vh] z-40 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5" />
              System Diagnostics & Auth Monitor
            </CardTitle>
            <CardDescription>
              Comprehensive testing and authentication monitoring
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={refreshAuthState}
              variant="outline"
              size="sm"
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
            >
              ×
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="tests">Tests</TabsTrigger>
            <TabsTrigger value="auth">Auth Status</TabsTrigger>
            <TabsTrigger value="backend">Backend</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="tests" className="space-y-4">
            <div className="flex gap-2">
              <Button
                onClick={runAllTests}
                disabled={isRunning}
                className="flex-1"
              >
                {isRunning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Run Tests
              </Button>

              <Button
                variant="outline"
                onClick={copyToClipboard}
                disabled={tests.length === 0}
              >
                {copiedRecently ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>

              <Button
                variant="outline"
                onClick={downloadLog}
                disabled={logEntries.length === 0}
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>

            {tests.length > 0 && (
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {tests.map((test, index) => (
                    <div key={index} className="flex items-start gap-2 p-2 rounded border">
                      {getStatusIcon(test.status)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium truncate">
                            {test.name}
                          </span>
                          {getStatusBadge(test.status)}
                        </div>
                        {test.result && (
                          <p className="text-xs text-gray-600 mt-1">
                            {test.result}
                          </p>
                        )}
                        {test.timestamp && (
                          <p className="text-xs text-gray-400">
                            {test.timestamp}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="auth" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Enhanced Auth Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span>Status:</span>
                  <Badge variant={enhancedAuth.isAuthenticated ? "default" : "destructive"}>
                    {enhancedAuth.isAuthenticated ? "Authenticated" : "Not Authenticated"}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span>Method:</span>
                  <Badge variant="outline" className="capitalize">
                    {enhancedAuth.authMethod}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span>Pending:</span>
                  <Badge variant={enhancedAuth.pending ? "secondary" : "outline"}>
                    {enhancedAuth.pending ? "Yes" : "No"}
                  </Badge>
                </div>
                {accounts.length > 0 && (
                  <div className="flex justify-between items-center">
                    <span>User:</span>
                    <span className="text-sm font-mono">
                      {accounts[0].name || accounts[0].username || 'Unknown'}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">MSAL State</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div>Accounts: {accounts.length}</div>
                  {accounts.map((account, index) => (
                    <div key={index} className="pl-4 text-xs">
                      <div>• {account.username}</div>
                      <div className="pl-2 text-gray-500">
                        {account.name || 'No display name'}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="backend" className="space-y-4">
            {backendStats?.authentication && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Backend Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span>Method:</span>
                    <Badge variant="outline">
                      {backendStats.authentication.method}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Legacy:</span>
                    <Badge variant={backendStats.authentication.legacy_enabled ? "default" : "secondary"}>
                      {backendStats.authentication.legacy_enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Entra:</span>
                    <Badge variant={backendStats.authentication.entra_enabled ? "default" : "secondary"}>
                      {backendStats.authentication.entra_enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {backendStats?.services && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Service Health</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(backendStats.services).map(([service, status]: [string, any]) => (
                      <div key={service} className="flex justify-between items-center">
                        <span className="capitalize text-sm">{service.replace('_', ' ')}:</span>
                        <Badge variant={status?.status === 'healthy' ? "default" : "destructive"}>
                          {status?.status || 'Unknown'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {backendStats?.cache_stats && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Timer className="w-4 h-4" />
                    Auth Cache
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Total Entries:</span>
                      <span>{backendStats.cache_stats.total_entries}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Valid Entries:</span>
                      <span>{backendStats.cache_stats.valid_entries}</span>
                    </div>
                    {backendStats.cache_stats.estimated_hit_rate !== undefined && (
                      <div className="flex justify-between">
                        <span>Hit Rate:</span>
                        <span>{backendStats.cache_stats.estimated_hit_rate.toFixed(1)}%</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="logs" className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Diagnostic Log</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLogEntries([])}
              >
                Clear
              </Button>
            </div>
            <ScrollArea className="h-64">
              <div className="text-xs font-mono space-y-1 p-2 bg-gray-50 rounded">
                {logEntries.length > 0 ? (
                  logEntries.map((entry, index) => (
                    <div key={index} className="whitespace-pre-wrap">
                      {entry}
                    </div>
                  ))
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    No log entries yet. Activity will appear here.
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
