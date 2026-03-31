
# GlossaryFilterMappingDto


## Properties

Name | Type
------------ | -------------
`detectorTypes` | Array&lt;string&gt;
`severities` | Array&lt;string&gt;
`findingTypes` | Array&lt;string&gt;
`customDetectorKeys` | Array&lt;string&gt;
`statuses` | Array&lt;string&gt;

## Example

```typescript
import type { GlossaryFilterMappingDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "detectorTypes": ["SECRETS","PII"],
  "severities": ["CRITICAL","HIGH"],
  "findingTypes": ["aws_key","ssn"],
  "customDetectorKeys": ["gdpr-scanner"],
  "statuses": ["OPEN"],
} satisfies GlossaryFilterMappingDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GlossaryFilterMappingDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


