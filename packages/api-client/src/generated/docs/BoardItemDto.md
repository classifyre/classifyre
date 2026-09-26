
# BoardItemDto


## Properties

Name | Type
------------ | -------------
`id` | string
`kind` | [CaseBoardItemKind](CaseBoardItemKind.md)
`refId` | string
`x` | number
`y` | number
`width` | number
`height` | number
`z` | number
`parentId` | string
`collapsed` | boolean
`style` | { [key: string]: any; }
`content` | { [key: string]: any; }
`createdBy` | string
`updatedBy` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { BoardItemDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "kind": null,
  "refId": null,
  "x": null,
  "y": null,
  "width": null,
  "height": null,
  "z": null,
  "parentId": null,
  "collapsed": null,
  "style": null,
  "content": null,
  "createdBy": null,
  "updatedBy": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies BoardItemDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BoardItemDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


