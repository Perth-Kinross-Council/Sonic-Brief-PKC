// Test component to debug category/subcategory loading
// You can temporarily add this to your app to test the API calls

import { useState } from 'react';
import { useFetchCategories, useFetchSubcategories } from '@/lib/api';
import type { CategoryResponse, SubcategoryResponse } from '@/lib/api';

export function CategoryDebugTest() {
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [subcategories, setSubcategories] = useState<SubcategoryResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useFetchCategories();
  const fetchSubcategories = useFetchSubcategories();

  const testFetch = async () => {
    setLoading(true);
    setError(null);
    try {
  // Removed commented debug logging: starting category/subcategory fetch test

      const [cats, subcats] = await Promise.all([
        fetchCategories().catch(err => {
          console.error('Categories fetch error:', err);
          return [];
        }),
        fetchSubcategories().catch(err => {
          console.error('Subcategories fetch error:', err);
          return [];
        })
      ]);

  // Removed commented debug logging: fetched categories & subcategories

      setCategories(cats);
      setSubcategories(subcats);
    } catch (err: any) {
      console.error('Test fetch error:', err);
      setError(err?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border rounded">
      <h3 className="text-lg font-bold mb-4">Category/Subcategory API Test</h3>

      <button
        onClick={testFetch}
        disabled={loading}
        className="bg-blue-500 text-white px-4 py-2 rounded mb-4"
      >
        {loading ? 'Testing...' : 'Test API Calls'}
      </button>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          Error: {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="font-semibold mb-2">Categories ({categories.length})</h4>
          <div className="bg-gray-100 p-2 rounded max-h-40 overflow-auto">
            {categories.length > 0 ? (
              <pre className="text-sm">
                {JSON.stringify(categories.map(c => ({ id: c.id, name: c.name })), null, 2)}
              </pre>
            ) : (
              <span className="text-gray-500">No categories loaded</span>
            )}
          </div>
        </div>

        <div>
          <h4 className="font-semibold mb-2">Subcategories ({subcategories.length})</h4>
          <div className="bg-gray-100 p-2 rounded max-h-40 overflow-auto">
            {subcategories.length > 0 ? (
              <pre className="text-sm">
                {JSON.stringify(subcategories.map(s => ({ id: s.id, name: s.name, category_id: s.category_id })), null, 2)}
              </pre>
            ) : (
              <span className="text-gray-500">No subcategories loaded</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
