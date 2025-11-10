

import { useState } from "react"
import { PlusCircle, FileText } from "lucide-react"
import { usePromptManagement } from "./prompt-management-context"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { notifyError, notifySuccess } from '@/lib/notify'

export function PromptManagementHeader() {
  const { addCategory, loading } = usePromptManagement()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [categoryName, setCategoryName] = useState("")

  const handleAddCategory = async () => {
    if (!categoryName.trim()) {
      notifyError('Category name cannot be empty')
      return
    }

    try {
  await addCategory(categoryName)
  notifySuccess('Category created successfully')
      setCategoryName("")
      setIsDialogOpen(false)
    } catch (error) {
  notifyError(error, 'Failed to create category')
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <nav
            className="flex items-center text-sm text-muted-foreground mb-1"
            aria-label="Breadcrumb"
          >
            <a href="/home" className="hover:underline">
              Home
            </a>
            <span className="mx-2">&gt;</span>
            <span className="font-semibold">Prompt Management</span>
          </nav>
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FileText className="h-5 w-5" />
            Prompt Management
          </h2>
          <p className="text-muted-foreground text-sm">
            Manage categories, subcategories, and prompts for your AI system.
          </p>
        </div>
        <Button onClick={() => setIsDialogOpen(true)}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Category
        </Button>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Category</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div key="category-name-field" className="grid gap-2">
              <Label htmlFor="name">Category Name</Label>
              <Input
                id="name"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="Enter category name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddCategory} disabled={loading}>
              {loading ? "Creating..." : "Create Category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

