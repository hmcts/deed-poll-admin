#!/bin/bash

# SonarCloud Project Auto-Setup Script
# This script checks if a SonarCloud project exists and creates it if not
# Used to enable automatic project provisioning for HMCTS organization

set -e

# Check if sonar-project.properties exists
if [ ! -f "sonar-project.properties" ]; then
  echo "Error: sonar-project.properties file not found"
  exit 1
fi

# Read configuration from sonar-project.properties
SONAR_PROJECT_KEY=$(grep "^sonar.projectKey=" sonar-project.properties | cut -d'=' -f2)
SONAR_PROJECT_NAME=$(grep "^sonar.projectName=" sonar-project.properties | cut -d'=' -f2)
SONAR_ORGANIZATION=$(grep "^sonar.organization=" sonar-project.properties | cut -d'=' -f2)

# Required environment variable
SONAR_TOKEN="${SONAR_TOKEN}"

# Validate required variables
if [ -z "$SONAR_TOKEN" ]; then
  echo "Error: SONAR_TOKEN environment variable is not set"
  exit 1
fi

if [ -z "$SONAR_PROJECT_KEY" ]; then
  echo "Error: sonar.projectKey not found in sonar-project.properties"
  exit 1
fi

if [ -z "$SONAR_PROJECT_NAME" ]; then
  echo "Error: sonar.projectName not found in sonar-project.properties"
  exit 1
fi

if [ -z "$SONAR_ORGANIZATION" ]; then
  echo "Error: sonar.organization not found in sonar-project.properties"
  exit 1
fi

# SonarCloud API base URL
SONAR_API_URL="https://sonarcloud.io/api"

echo "Checking if SonarCloud project exists: $SONAR_PROJECT_KEY"

# Check if project exists
PROJECT_CHECK=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $SONAR_TOKEN" \
  "$SONAR_API_URL/projects/search?organization=$SONAR_ORGANIZATION&projects=$SONAR_PROJECT_KEY")

if [ "$PROJECT_CHECK" = "200" ]; then
  # Check if project is in the results
  PROJECT_EXISTS=$(curl -s \
    -H "Authorization: Bearer $SONAR_TOKEN" \
    "$SONAR_API_URL/projects/search?organization=$SONAR_ORGANIZATION&projects=$SONAR_PROJECT_KEY" | \
    grep -c "\"key\":\"$SONAR_PROJECT_KEY\"" || true)
  
  if [ "$PROJECT_EXISTS" -gt 0 ]; then
    echo "✓ Project already exists: $SONAR_PROJECT_KEY"
    exit 0
  fi
fi

echo "Project not found. Creating new SonarCloud project..."

# Create the project
CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $SONAR_TOKEN" \
  -d "organization=$SONAR_ORGANIZATION" \
  -d "project=$SONAR_PROJECT_KEY" \
  -d "name=$SONAR_PROJECT_NAME" \
  -d "visibility=public" \
  "$SONAR_API_URL/projects/create")

HTTP_CODE=$(echo "$CREATE_RESPONSE" | tail -n 1)
RESPONSE_BODY=$(echo "$CREATE_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ Successfully created SonarCloud project: $SONAR_PROJECT_KEY"
  
  # Set up main branch
  echo "Setting up main branch configuration..."
  curl -s -X POST \
    -H "Authorization: Bearer $SONAR_TOKEN" \
    -d "project=$SONAR_PROJECT_KEY" \
    -d "branch=master" \
    "$SONAR_API_URL/project_branches/rename" > /dev/null 2>&1 || true
    
  echo "✓ Project setup complete"
else
  echo "Error creating project. Response code: $HTTP_CODE"
  echo "Response: $RESPONSE_BODY"
  
  # Check if it's a permission error
  if echo "$RESPONSE_BODY" | grep -q "Insufficient privileges"; then
    echo ""
    echo "Note: The SONAR_TOKEN may not have permission to create projects."
    echo "Please ensure the token has 'Execute Analysis' and project creation permissions."
    echo "You may need to manually create the project in SonarCloud UI first."
  fi
  
  exit 1
fi