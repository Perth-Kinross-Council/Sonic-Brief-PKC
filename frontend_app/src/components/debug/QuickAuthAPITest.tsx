// Quick debug component to test auth and API calls
// Add this temporarily to your page to test

import { useState } from 'react';
import { useEnhancedUnifiedAuth } from '@/lib/useEnhancedUnifiedAuth';
import { useFetchCategories, useFetchSubcategories } from '@/lib/api';

export function QuickAuthAPITest() {
  const auth = useEnhancedUnifiedAuth();
  const fetchCategories = useFetchCategories();
  const fetchSubcategories = useFetchSubcategories();
  const [result, setResult] = useState('');

  const testAuthAndAPI = async () => {
    setResult('Testing...');
    try {
  // Removed commented debug logging: auth state snapshot

      if (auth.isLoading) {
        setResult('❌ Auth is still loading');
        return;
      }

      if (!auth.isAuthenticated) {
        setResult('❌ Not authenticated');
        return;
      }

      // Wait a bit for auth to stabilize
      await new Promise(resolve => setTimeout(resolve, 300));

      const [categoriesResult, subcategoriesResult] = await Promise.all([
        fetchCategories().catch(err => ({ error: err.message })),
        fetchSubcategories().catch(err => ({ error: err.message }))
      ]);

      const categories = Array.isArray(categoriesResult) ? categoriesResult : [];
      const subcategories = Array.isArray(subcategoriesResult) ? subcategoriesResult : [];
      const categoriesError = !Array.isArray(categoriesResult) ? categoriesResult.error : null;
      const subcategoriesError = !Array.isArray(subcategoriesResult) ? subcategoriesResult.error : null;

      setResult(`✅ Auth OK
Categories: ${categoriesError ? `Error: ${categoriesError}` : `${categories.length} items`}
Subcategories: ${subcategoriesError ? `Error: ${subcategoriesError}` : `${subcategories.length} items`}

Sample data:
${JSON.stringify({
  firstCategory: categories[0] || null,
  firstSubcategory: subcategories[0] || null
}, null, 2)}`);

    } catch (error: any) {
      setResult(`❌ Error: ${error.message}`);
    }
  };

  return (
    <div className="p-4 border border-gray-300 rounded-lg m-4">
      <h3 className="font-bold mb-2">Auth & API Quick Test</h3>
      <p className="text-sm mb-2">
        Auth Status: {auth.isLoading ? 'Loading...' : auth.isAuthenticated ? 'Authenticated' : 'Not Authenticated'}
      </p>
      <button
        onClick={testAuthAndAPI}
        className="bg-blue-500 text-white px-3 py-1 rounded mb-2"
      >
        Test API Calls
      </button>
      <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto max-h-40">
        {result}
      </pre>
    </div>
  );
}
