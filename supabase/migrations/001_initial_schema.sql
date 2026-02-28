-- ============================================
-- ScreenAI — Initial Database Schema
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Profiles (extends Supabase auth.users)
-- ============================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  avatar_url TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- Projects
-- ============================================
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  default_provider TEXT DEFAULT 'claude',
  default_model TEXT DEFAULT 'claude-sonnet-4-20250514',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_projects_user ON projects(user_id);

-- ============================================
-- Conversations
-- ============================================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT DEFAULT 'New conversation',
  provider TEXT NOT NULL DEFAULT 'claude',
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_project ON conversations(project_id);

-- ============================================
-- Messages
-- ============================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT DEFAULT '',
  screenshot_url TEXT,
  annotations JSONB DEFAULT '[]',
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_created ON messages(conversation_id, created_at);

-- ============================================
-- User Settings
-- ============================================
CREATE TABLE user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AI Proxy Usage (quota tracking)
-- ============================================
CREATE TABLE proxy_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_proxy_usage_user_date ON proxy_usage(user_id, created_at);

-- ============================================
-- Affiliate Config (Phase 5 preparation)
-- ============================================
CREATE TABLE affiliate_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner TEXT NOT NULL,
  tag TEXT NOT NULL,
  url_template TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Row Level Security (RLS)
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxy_usage ENABLE ROW LEVEL SECURITY;

-- Profiles: users can only read/update their own
CREATE POLICY profiles_select ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (auth.uid() = id);

-- Projects: users can CRUD their own
CREATE POLICY projects_select ON projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY projects_insert ON projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY projects_update ON projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY projects_delete ON projects FOR DELETE USING (auth.uid() = user_id);

-- Conversations: users can CRUD their own
CREATE POLICY conversations_select ON conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY conversations_insert ON conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY conversations_update ON conversations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY conversations_delete ON conversations FOR DELETE USING (auth.uid() = user_id);

-- Messages: users can CRUD messages in their conversations
CREATE POLICY messages_select ON messages FOR SELECT
  USING (conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid()));
CREATE POLICY messages_insert ON messages FOR INSERT
  WITH CHECK (conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid()));
CREATE POLICY messages_delete ON messages FOR DELETE
  USING (conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid()));

-- User Settings: users can CRUD their own
CREATE POLICY settings_select ON user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY settings_insert ON user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY settings_update ON user_settings FOR UPDATE USING (auth.uid() = user_id);

-- Proxy Usage: users can read their own, service role can insert
CREATE POLICY proxy_usage_select ON proxy_usage FOR SELECT USING (auth.uid() = user_id);

-- ============================================
-- Storage bucket for screenshots
-- ============================================
INSERT INTO storage.buckets (id, name, public) VALUES ('captures', 'captures', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: users can upload/read their own captures
CREATE POLICY captures_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'captures' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY captures_select ON storage.objects FOR SELECT
  USING (bucket_id = 'captures' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY captures_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'captures' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================
-- Updated_at trigger
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER conversations_updated BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER settings_updated BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
