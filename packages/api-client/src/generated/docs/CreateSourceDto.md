
# CreateSourceDto


## Properties

Name | Type
------------ | -------------
`type` | string
`name` | string
`config` | object
`scheduleEnabled` | boolean
`scheduleCron` | string
`scheduleTimezone` | string

## Example

```typescript
import type { CreateSourceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "type": WORDPRESS,
  "name": Production WordPress,
  "config": {"type":"WORDPRESS","required":{"url":"https://blog.example.com"},"masked":{"username":"admin","application_password":"your-application-password"},"optional":{"content":{"fetch_posts":true,"fetch_pages":true}}},
  "scheduleEnabled": true,
  "scheduleCron": 30 1 * * *,
  "scheduleTimezone": UTC,
} satisfies CreateSourceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateSourceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


